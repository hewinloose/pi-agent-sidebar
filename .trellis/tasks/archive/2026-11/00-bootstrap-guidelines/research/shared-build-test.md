# Research: shared protocol layer, build, tests, quality gates

Scope: `shared/`, `scripts/`, `test/`, `tsconfig.json`, `package.json`, `.prettierrc`. Every claim is
read from the cited file; unverifiable ones are marked `unverified`.

`package.json` has **no `dependencies` field** — `marked`, `dompurify`, `mermaid`, `highlight.js` are
devDependencies bundled into the webview output (hence `vsce package --no-dependencies`).

---

## 1. Layer rules: `shared/` vs `src/` vs `webview/`

| Layer | Contents | Examples |
|---|---|---|
| `shared/` | wire types, hand-written parsers, pure helpers used by **both** sides | `protocol.ts`, `protocolParser.ts`, `composerReferences.ts`, `jsonValues.ts`, `messageContent.ts`, `assertNever.ts` |
| `src/` | VS Code API, pi process lifecycle, persistence | `src/rpc/piRpcClient.ts`, `src/services/sessionStore.ts`, `src/provider/piViewProvider.ts` |
| `webview/` | DOM rendering, composer state, browser-only libs | `webview/transcript/renderer.ts`, `webview/main.ts` |

Project statement, CONTRIBUTING.md:106-107: *"Keep extension-host code separate from browser-only
Webview code. Shared modules must remain safe for every runtime that imports them."*

**Import direction (grep-verified).** `shared/*.ts` has **zero bare-specifier imports** — no npm
package, no `vscode`, no `node:*`; only `./protocol.js` plus type-only siblings
(`grep 'from "[a-z@]' shared/*.ts` → nothing). `shared/protocol.ts:451` re-exports the parser:
`export { parseWebviewMessage } from "./protocolParser.js";`. `src/` imports only `vscode`,
`node:*`, and relative paths; `webview/` never imports from `src/`. Both sides reach shared
relatively: `../../shared/protocol.js` from `src/provider/*` and `webview/composer/*`,
`../shared/protocol.js` from `webview/*.ts`.

**Rule for spec:** `shared/` stays importable in a browser, in Node, and in the extension host —
helpers moved there because both runtimes need them (`shared/messageContent.ts:12-14`: "a second copy
of this rule would drift"; `shared/jsonValues.ts:4-13`: "three byte-identical copies had already
accumulated").

### Runtime validation of untrusted input — two parsers, opposite failure modes

No zod/ajv anywhere: every boundary is a hand-written bounded parser.

**(a) Webview → host**, `shared/protocolParser.ts:17-117`:

```ts
export function parseWebviewMessage(value: unknown): WebviewToHostMessage | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	const message = value as Record<string, unknown>;
	const type = boundedString(message.type, 64);
	if (!type) return;
	...
```
- Returns `undefined`, **never throws**; one branch per variant, grouped when payload shapes match
  (`:42-45`). Unknown fields are *dropped, not rejected*: a fresh object is rebuilt (`:23-29` for
  `submit`), so a forged `attachments` field disappears (`test/unit/shared/protocol.test.mjs:15-29`).
- Every field is bounded: `boundedString(value, maxLength)`, `boundedStringArray(value, maxItems,
  maxLength)`, `nonNegativeInteger` via `Number.isSafeInteger` (`:157-176`). Caps are either shared
  and exported (`shared/protocol.ts:436-449`) or module-local `MAX_*` (`:10-15`).
- Host ignores failures and logs: `src/provider/piViewProvider.ts:656-660` →
  `"[webview] Ignored an invalid message."`

**(b) pi → host**, `src/rpc/rpcValidation.ts`: same discipline, opposite mode. `parsePiState(value:
unknown): PiState` **throws** `ProtocolValidationError` with a dotted field path
(`"state.sessionName"`) (`:26-45`); caps `MAX_MESSAGES = 5_000`, `MAX_CONTENT_BLOCKS = 10_000`,
`MAX_TEXT_LENGTH = 1_000_000` (`:14-24`). Field-by-field validation, then `state as PiState` —
cast *after* validation.

**(c) pi events in the webview** are not schema-validated; they go through
`objectValue`/`stringValue`/`numberValue`, which return benign empties instead of throwing
(`shared/jsonValues.ts:17-29`).

### `assertNever` exhaustiveness

```ts
// shared/assertNever.ts:13-15
export function assertNever(value: never): never {
	throw new Error(`Unhandled message variant: ${JSON.stringify(value)}`);
}
```
Exactly two uses, both the `default:` arm of a `switch` over a protocol union:
`webview/hostMessageHandler.ts:73-74` (`HostToWebviewMessage`) and
`src/provider/webviewMessageRouter.ts:133-134` (`WebviewToHostMessage`). Its JSDoc records the
prevented bug: adding a variant compiled cleanly because `default` was `break`, and the message
vanished at runtime.

A second compile-time guard covers the runtime list `WEBVIEW_REQUEST_TYPES`
(`shared/protocol.ts:378-434`): the list is `as const satisfies readonly
WebviewToHostMessage["type"][]`, and `type UnlistedRequestType = Exclude<…>` is passed to a
`void`-only assertion function — it is `never` only when the list covers the union, so a missing
entry fails `tsc`. `test/unit/shared/protocol.test.mjs` walks the same list and proves the parser
accepts a valid message of every variant.

---

## 2. Type safety conventions

`tsconfig.json` — one config for all three layers, `include: ["src/**/*.ts",
"webview/**/*.ts", "shared/**/*.ts"]`:

- `target/module/moduleResolution`: `ES2022` / `NodeNext` / `NodeNext`; `lib`: `ES2022`, `DOM`,
  `DOM.Iterable`; `types: ["node", "vscode"]`; `rootDir: "."`.
- `strict: true`, `noUncheckedIndexedAccess: true` (so `arr[i]` is `T | undefined`),
  `noImplicitOverride: true`, `esModuleInterop`, `skipLibCheck`. **Not** enabled:
  `noImplicitReturns`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUnusedLocals`.
- `NodeNext` ⇒ **every relative import ends in `.js`** (153 occurrences, zero exceptions);
  `import type { … }` wherever type-only (`shared/protocolParser.ts:1`).
- `lib` includes DOM and `types` includes node+vscode globally, so this single config does **not**
  isolate layers by types; the boundary is held by review and import direction.
- `unknown` at every boundary (`parseWebviewMessage(value: unknown)`, `parsePiState(value:
  unknown)`, `contentText(content: unknown)`). `any` appears nowhere in `src/`, `webview/`,
  `shared/` — grep for `: any`, `<any>`, `as any` hits only prose.
- Protocol types are `interface X extends JsonRecord` with `JsonRecord = Record<string, unknown>`
  (`shared/protocol.ts:1-26`), so pi's extra fields survive while access stays typed. Where an
  index signature would hurt, it is deliberately omitted — `PiCapabilities`
  (`:35-46`) explains it would widen `keyof` to `string` and lose per-flag typing.
- Open-ended enums: `"extension" | "prompt" | "skill" | (string & {})` (`:78-79`) so a future
  unknown value degrades instead of failing validation.
- Discriminated unions are the transport: `HostToWebviewMessage`/`WebviewToHostMessage` are unions
  of object literals keyed on `type` (`:207-362`); sub-payloads use `kind`
  (`WorkspaceEntrySuggestion`, `ComposerReference`, `:96-182`). Narrowing helpers take `Pick<…>`
  rather than partial re-declarations (`shared/composerReferences.ts:62-79`).
- `as const satisfies` for literal types *with* checking (`shared/protocol.ts:408`,
  `webview/sanitizerPolicy.ts:34`, `src/rpc/piRpcClient.ts:449`); plain `as const` for constant
  tuples (`src/rpc/binaryProbe.ts:7`, `src/rpc/windowsPiLaunch.ts:13`). Documentation convention:
  long JSDoc explaining *why*, often naming the bug that motivated the shape
  (`shared/protocol.ts:218-235`, `:278-287`) — the strongest written convention here.

---

## 3. Build: `scripts/build.mjs`

One esbuild script, four entries, built in parallel (`:84-99`). Shared options (`:40-45`):
`bundle: true`, `minify: production`, `sourcemap: production ? false : "inline"`.

| Output | Entry | platform / format / target |
|---|---|---|
| `dist/extension.js` | `src/extension.ts` | `node` / `cjs` / `node22`, `external: ["vscode"]` (`:47-55`) |
| `dist/webview/main.js` | `webview/main.ts` | `browser` / `iife` / `chrome120` (`:57-64`) |
| `dist/webview/mermaid.js` | `webview/mermaidBundle.ts` | `browser` / `iife` / `chrome120`; separate entry because it is fetched on demand and an iife chunk cannot be lazy-loaded (`:66-75`) |
| `dist/webview/main.css` | `webview/main.css` | `chrome120`; esbuild resolves the 9 `@import "./styles/*.css"` lines into one file (`:77-82`) |

- `dist/` and legacy `media/` are wiped first (`:15-19`); `--clean` exits after the wipe. Flags:
  `--production`, `--watch`, `--clean`, `--out-dir=<dir>` (`:7-13`).
- Assets: only codicons are copied — `codicon.css` and `codicon.ttf` into `dist/webview/codicons/`
  (`:29-38`). Nothing is base64-inlined. `assets/` (SVG/PNG icons) is not copied; it ships via
  `package.json:files` → `assets/**`. HTML loads the built files through `webview.asWebviewUri`
  (`src/webviewDocument.ts:10-23`).
- `package.json` wiring: `build`, `watch`, `clean`, `vscode:prepublish` (`build --production`) and
  `package` (`typecheck && test:unit && build --production && vsce package --no-dependencies`).

### `scripts/check-generated.mjs` — what it guards

A **reproducible-build** gate, not a "generated file was committed" gate (`dist/` is gitignored,
`.gitignore:2`). It builds production output twice into temp dirs (`:57-61`), then:

1. asserts the manifest equals exactly six paths (`:8-15`), flagging any missing or added file;
2. byte-compares the two builds per file → `Non-reproducible files: …` (`:83-89`);
3. asserts minified `main.css` still contains one rule per component — `#app{`,
   `.transcript{`, `.mermaid-block{`, `.history-panel{`, `.command-panel{`, `.composer-shell{`,
   `.modal-backdrop{`, `@media(max-width:320px)` (`:17-26`, `:91-97`). This catches a dropped
   `@import`;
4. summarises errors and sets exit code 1 (`:99-117`), else prints "Production build is
   complete and reproducible."

---

## 4. Testing

**Runner.** `node --test`, built into Node; no vitest/jest/mocha in `devDependencies`. Script:
`node --test test/unit/host/*.test.mjs test/unit/shared/*.test.mjs test/unit/webview/*.test.mjs
test/integration/*.test.mjs` — four explicit globs, so a new test directory must be added here.
Helpers: `test/helpers/`; fixtures: `test/fixtures/`. Size: host 15, shared 2, webview 42, integration 2 files, ~395 `test()` calls.

**Why `.mjs` tests for `.ts` sources.** Tests never import TypeScript: each test bundles the module
under test to ESM in a temp dir with esbuild and imports that bundle (`tsc` never looks at `test/`).
Naming maps kebab-case to the source module: `src/provider/asyncQueue.ts` →
`test/unit/host/async-queue.test.mjs`; `src/rpc/rpcValidation.ts` →
`test/unit/host/rpc-validation.test.mjs`. One source file may own several test files when behaviours
are distinct — `webview/transcript/renderer.ts` is covered by `transcript.test.mjs`,
`transcript-sections.test.mjs`, `markdown-cjk.test.mjs`, `highlight-integration.test.mjs`.

**The loader** (`test/helpers/load-bundled-module.mjs:16-53`):

```js
await build({ entryPoints: [path.resolve(projectRoot, entry)], outfile: output,
	bundle: true, platform, format: "esm", target, logLevel: "silent", plugins, external, define });
return { module: await import(`${pathToFileURL(output).href}?v=${Date.now()}-…`),
         temporaryDirectory, dispose: () => rm(temporaryDirectory, { recursive: true, force: true }) };
```
Callers pass `{ entry: "src/rpc/rpcValidation.ts", name: "validation" }` and dispose via
`try/finally loaded.dispose()` or `t.after(loaded.dispose)`. `platform: "browser"` (target
`chrome120`) loads browser modules inside Node; the test supplies DOM globals. Plugins stay in
the test file so module-specific mocks are visible where used (`:9-15`).

**Faking the VS Code API (host tests).** An esbuild plugin resolves `vscode` to a generated stub
module reading a per-test state object off `globalThis`
(`test/unit/host/workspace-resources.test.mjs:9-50`): `onResolve(/^vscode$/)` → namespace
`mock-vscode`, `onLoad` → JS source with `const state = () => globalThis.__workspaceResourcesVscodeMock;`
plus hand-written `Uri`/`workspace`/`window` exports; each test sets the global, then `delete`s it.
Same pattern in the `composer-reference-store`, `transcript-media`, `workspace-file-search` tests;
`scripts/preview/document.mjs:8-30` uses the simpler `alias: { vscode: stub }` form.

**Faking the pi process (transport tests).** A real child process, `test/fixtures/fake-rpc.mjs`,
spawned as `binary: process.execPath, args: [<fixture>]` (`test/unit/host/rpc-client.test.mjs:16-23`).
It speaks the real newline-delimited JSON RPC shape (`{"id","type":"response","command","success",
"data"}`) and encodes each protocol pathology as a command name: `mismatched_command`,
`invalid_success`, `unidentified_response`, `cancelled_mutation`, `exit_now`, `hang`,
`spawn_helper` (spawns a grandchild to test process-tree kill); it also splits a UTF-8 sequence
mid-character to exercise `StringDecoder` (`:119-136`). Fixture data is documented as captured from
a real probe (`fake-rpc.mjs:11`: "Shapes captured from a live `pi --mode rpc` 0.84.3 probe").

**Faking the DOM (webview tests).** No jsdom; two styles: (i) plain-object collaborators —
`test/helpers/transcript-harness.mjs:4-32` builds the *real* `TranscriptController` with a fake
`container` (`insertBefore`/`removeChild` over an array), a recording `createNode`, and effect sinks
pushing names into an array, asserted via `children`/`effects`; (ii) a minimal `FakeElement`
installed as `globalThis.Element` for one call, restored in `finally`
(`test/unit/webview/mermaid.test.mjs:94-103`). Third-party browser libs are stubbed with an esbuild
`onLoad` returning generated JS, e.g. a fake `dompurify` recording its `Config`
(`test/unit/webview/sanitizer-policy.test.mjs:71-100`).

**Unit vs integration.** Unit tests target one module's exported behaviour, many purely functional
(validation, payload construction, reducers, windowing math) — CONTRIBUTING.md:120-122 prefers pure
functions because they need no running VS Code. Integration tests are deliberately end-to-end:

- `test/integration/manifest.test.mjs` reads `package.json` and source files as text and pins
  user-facing contracts: the exact command-ID list, the `ctrl+escape`/`cmd+escape` keybinding, menu
  `when` clauses (`:21-54`); plus structural invariants on raw HTML/CSS — the pinned-prompt rail must
  live inside `#transcript` and `.pinned-prompt-slot` must be `position: sticky; height: 0` (`:56-94`).
- `test/integration/webview-browser.test.mjs:16-36` builds a full asset tree with `scripts/build.mjs
  --out-dir=<tmp>`, renders the real `createWebviewDocument()`, injects
  `test/fixtures/webview-refactor-scenario.js` under the page's CSP nonce, runs headless Chrome
  (`--headless=new --dump-dom --virtual-time-budget=12000`) and asserts `data-test-complete="true"`
  with no `data-test-error`. It `t.skip`s when no browser exists (`:18`), justified in a comment:
  *"isolated controller tests cannot catch initialization order failures"* (`:14-15`); 90 s timeout.

---

## 5. Quality gates (`package.json`)

```json
"typecheck":       "tsc --noEmit",
"test:unit":       "node --test test/unit/host/*.test.mjs test/unit/shared/*.test.mjs test/unit/webview/*.test.mjs test/integration/*.test.mjs",
"test":            "npm run typecheck && npm run test:unit",
"check:generated": "node scripts/check-generated.mjs",
"verify":          "npm run typecheck && npm run test:unit && npm run check:generated",
"test:rpc":        "node scripts/rpc-smoke.mjs"
```

- The commit/PR gate is **`npm run verify`** (CONTRIBUTING.md:72). CI mirrors it: `.github/workflows/ci.yml`
  runs `npm ci` then `npm run verify` in job `verify` (ubuntu, 10 min) and `verify-windows` (windows,
  20 min) — Windows exists to execute `windowsPiLaunch.ts`, the non-POSIX process-tree kill, and paths.
- `test:unit` is broader than its name: it also runs `test/integration/*`. `npm test` =
  `typecheck && test:unit` (no reproducibility check).
- `test:rpc` is in no aggregate: `scripts/rpc-smoke.mjs` spawns a real pi (`PI_BINARY` env or `pi`
  on PATH, `--mode rpc --no-session --offline --no-approve`), sends `get_state`, expects a reply
  within 15 s. Opt-in only.
- `npm run preview` (`scripts/preview.mjs`) is an explicit devtool: headless-Chrome screenshot of the
  real document with faked `acquireVsCodeApi()` and injected `--vscode-*` variables (`:1-29`); not in
  `npm test`, not shipped. `package.json` also holds a `knip` config, but `knip` is neither a
  dependency nor a script — it is currently inert (`unverified` whether intended).

---

## 6. Formatting and lint

- `.prettierrc` (entire file): `{ "useTabs": true, "tabWidth": 2 }` — nothing else set.
- **prettier is not installed** (absent from `devDependencies` and `node_modules/.bin`), there is no
  `format` script, and **no ESLint config** exists (no `.eslintrc*`, no `eslint.config.*`, no lint
  script). Formatting is a review convention: tabs, double quotes, semicolons, trailing commas in
  multiline literals — as in `shared/protocol.ts`, `shared/protocolParser.ts`, `scripts/build.mjs`.
- **Known inconsistency (document, don't "fix"):** 118 source/test files indent with tabs; 26 use
  **one-space** indentation (`shared/assertNever.ts`, `shared/messageContent.ts`,
  `webview/transcript/controller.ts`, `webview/app/state.ts`, `webview/session/*`, `webview/ui/*`,
  `test/unit/webview/transcript-controller.test.mjs`, several other `test/unit/webview/*`). New code
  should match the file it edits.
- All checked files use CRLF; `.gitattributes` only sets `.trellis/workspace/*/journal-*.md
  merge=union` and does not normalise EOL.
- Naming: `camelCase` module filenames with kebab-case test names; `PascalCase` classes
  (`PiRpcClient`, `TranscriptController`) and types; `UPPER_SNAKE` module constants.

---

## 7. Rules worth encoding in `.trellis/spec/`

1. `shared/` imports only `./` siblings with a `.js` suffix; never `vscode`, `node:*`, a DOM global,
   or an npm package.
2. A new protocol variant needs coordinated edits: union member in `shared/protocol.ts`, parser
   branch in `shared/protocolParser.ts`, dispatch `case` in both
   `src/provider/webviewMessageRouter.ts` and `webview/hostMessageHandler.ts` (or
   `WEBVIEW_REQUEST_TYPES` + its assertion for webview→host), plus a test. A missing dispatch case
   fails `tsc` via `assertNever`.
3. Untrusted input: `unknown` + a bounded hand-written parser; no schema library, no `any`, no cast
   before validation. Webview→host returns `undefined`; pi→host throws `ProtocolValidationError`.
4. Numeric limits are named `MAX_*`; when both sides must agree they are exported from
   `shared/protocol.ts`.
5. The `--production` build must stay byte-reproducible and keep one rule per CSS component; a new
   `webview/styles/*.css` file goes into `webview/main.css` and, if it is a new component, into
   `check-generated.mjs:17-26`.
6. A new module gets `test/unit/{host,shared,webview}/<kebab-name>.test.mjs` loaded via
   `loadBundledModule({ entry: "<path>.ts", name: "<name>" })` with `try/finally loaded.dispose()` or
   `t.after`; a new test directory must be added to the `test:unit` glob.
7. Behaviour only real Chrome or a real `pi` binary can prove stays opt-in (`t.skip` / `test:rpc`) and
   must never hard-fail `npm run verify`.
