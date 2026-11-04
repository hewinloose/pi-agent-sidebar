# Testing

> Node's built-in test runner, `.mjs` tests that load TypeScript by bundling it
> with esbuild. No Jest, no Vitest, no jsdom.

---

## When this applies

Adding or changing behavior, adding a module, or touching protocol validation,
resource boundaries, or anything pi-related.

---

## 1. Runner and layout

```
test/
├── unit/host/       src/ modules (vscode-dependent or not)
├── unit/shared/     shared/ modules
├── unit/webview/    webview/ modules
├── integration/     manifest pins + real-Chrome smoke
├── helpers/         load-bundled-module.mjs, transcript-harness.mjs
└── fixtures/        fake-rpc.mjs, webview-refactor-scenario.js
```

- `npm run test:unit` runs **four explicit globs**. A new test directory must be
  added to the `test:unit` script in `package.json`, or it silently never runs.
- `npm test` = `typecheck && test:unit`. It does not run `check:generated`.
- Naming maps kebab-case to the source module:
  `src/provider/asyncQueue.ts` → `test/unit/host/async-queue.test.mjs`;
  `src/rpc/rpcValidation.ts` → `test/unit/host/rpc-validation.test.mjs`.
  One source file may own several test files when behaviors are distinct
  (`webview/transcript/renderer.ts` → `transcript.test.mjs`,
  `transcript-sections.test.mjs`, `markdown-cjk.test.mjs`,
  `highlight-integration.test.mjs`).

## 2. How a `.mjs` test loads a `.ts` module

Tests never import TypeScript directly. `loadBundledModule`
([test/helpers/load-bundled-module.mjs:16](../../../test/helpers/load-bundled-module.mjs))
bundles the entry to ESM in a temp directory with esbuild and dynamically imports
it:

```js
const loaded = await loadBundledModule({ entry: "src/provider/deliveryPolicy.ts", name: "delivery-policy" });
try {
  // assertions
} finally {
  loaded.dispose();
}
```

- Always dispose — `try/finally` or `t.after(loaded.dispose)`.
- `platform: "browser"` (with `target: chrome120`) loads browser modules inside
  Node; the test supplies whatever DOM globals the module touches.
- esbuild plugins stay in the test file so the mock is visible where it is used.

## 3. Faking the VS Code API

There is no `vscode` shim. Host tests add an esbuild plugin that resolves
`vscode` to a generated stub module reading a per-test state object off
`globalThis` ([test/unit/host/workspace-resources.test.mjs](../../../test/unit/host/workspace-resources.test.mjs)):

- `onResolve(/^vscode$/)` → namespace `mock-vscode`;
- `onLoad` → generated JS with hand-written `Uri` / `workspace` / `window`;
- each test sets the global, then deletes it.

Same pattern in `composer-reference-store`, `transcript-media`, and
`workspace-file-search` tests. Prefer the cheaper path first: extract the decision
into a pure module (see [architecture/layer-boundaries.md](../architecture/layer-boundaries.md))
instead of mocking the editor.

## 4. Faking pi

Transport tests spawn a **real** child process:
`binary: process.execPath, args: [test/fixtures/fake-rpc.mjs]`
([test/unit/host/rpc-client.test.mjs](../../../test/unit/host/rpc-client.test.mjs)).
The fixture speaks the real newline-delimited JSON RPC shape and encodes each
pathology as a command name: `mismatched_command`, `invalid_success`,
`unidentified_response`, `cancelled_mutation`, `exit_now`, `hang`,
`spawn_helper` (spawns a grandchild so process-tree kill is exercised). It also
splits a UTF-8 sequence mid-character to prove `StringDecoder` usage.

When you add a transport behavior, add the pathology to the fixture rather than
mocking the child process.

## 5. Faking the DOM

No jsdom. Two accepted styles:

1. **Plain-object collaborators.** [test/helpers/transcript-harness.mjs](../../../test/helpers/transcript-harness.mjs)
   builds the *real* `TranscriptController` with a fake `container`
   (`insertBefore` / `removeChild` over an array), a recording `createNode`, and
   effect sinks, then asserts on `children` / `effects`.
2. **A minimal `FakeElement`** installed as `globalThis.Element` for one call and
   restored in `finally` (see `mermaid.test.mjs`).

Third-party browser libraries are stubbed with an `onLoad` plugin returning
generated JS — for example a fake `dompurify` that records the `Config` it
received (`sanitizer-policy.test.mjs`).

## 6. Unit vs integration

- **Unit:** one module's exported behavior. Prefer pure functions — validation,
  payload construction, reducers, windowing math — because they need no running
  VS Code (CONTRIBUTING.md).
- **Integration:** deliberately end-to-end.
  - [manifest.test.mjs](../../../test/integration/manifest.test.mjs) reads
    `package.json` and source files **as text** and pins user-facing contracts:
    the exact command-id list, the `ctrl+escape` / `cmd+escape` keybinding, menu
    `when` clauses, and structural HTML/CSS invariants (the pinned-prompt rail
    lives inside `#transcript`; `.pinned-prompt-slot` is
    `position: sticky; height: 0`).
  - [webview-browser.test.mjs](../../../test/integration/webview-browser.test.mjs)
    builds a real asset tree, renders `createWebviewDocument()`, injects a
    scenario under the page's CSP nonce, and runs headless Chrome
    (`--headless=new --dump-dom --virtual-time-budget=12000`), asserting
    `data-test-complete="true"` and no `data-test-error`. It `t.skip`s when no
    browser exists — isolated controller tests cannot catch initialization-order
    failures.

## 7. What must never happen

- Do not add a dependency just to test (no vitest/mocha/jsdom).
- Do not make a Chrome- or `pi`-dependent test mandatory for `npm run verify`.
- Do not write a test that passes with the feature deleted (check the assertion
  actually depends on the behavior).
- Do not `import` a `.ts` file from a test; always go through the loader.
- Do not leave a `loaded` bundle undisposed — it leaks temp directories.

## 8. Adding a test — checklist

- [ ] File at `test/unit/{host,shared,webview}/<kebab-name>.test.mjs`, mirroring the module.
- [ ] Loaded with `loadBundledModule({ entry, name })`, disposed in `finally`/`t.after`.
- [ ] Mocks declared in the file's own esbuild plugin.
- [ ] `node --test <file>` passes locally, then `npm run verify`.
- [ ] New directory? Add its glob to the `test:unit` script.
