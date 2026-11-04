# Build and Release

> One esbuild script, four entries, a reproducible-build gate, and CI that runs
> the same commands a maintainer does.

---

## When this applies

Changing `scripts/`, adding an asset or a CSS file, touching `package.json`
scripts/`files`, or anything that affects `dist/`.

---

## 1. Build entries

[scripts/build.mjs](../../../scripts/build.mjs) builds four outputs in parallel.
Shared options: `bundle: true`, `minify` in production, inline sourcemaps in dev.

| Output | Entry | Platform / format / target | Notes |
|--------|-------|---------------------------|-------|
| `dist/extension.js` | `src/extension.ts` | `node` / `cjs` / `node22` | `external: ["vscode"]` |
| `dist/webview/main.js` | `webview/main.ts` | `browser` / `iife` / `chrome120` | |
| `dist/webview/mermaid.js` | `webview/mermaidBundle.ts` | `browser` / `iife` / `chrome120` | Separate entry: it is fetched on demand, and an IIFE chunk cannot be lazily loaded |
| `dist/webview/main.css` | `webview/main.css` | `chrome120` | esbuild inlines the nine `@import "./styles/*.css"` lines |

- `dist/` and the legacy `media/` directory are wiped first; `--clean` exits after
  the wipe.
- Flags: `--production`, `--watch`, `--clean`, `--out-dir=<dir>`.
- Assets: only codicons are copied (`codicon.css`, `codicon.ttf` →
  `dist/webview/codicons/`). `assets/` ships via `package.json` → `files`, not
  through the bundler. HTML references built files through `webview.asWebviewUri`
  in `src/webviewDocument.ts`.
- `dist/` is gitignored. Never commit or hand-edit build output.

## 2. The reproducible-build gate

[scripts/check-generated.mjs](../../../scripts/check-generated.mjs) builds
production output twice into temp dirs and then:

1. asserts the output set equals exactly six paths — `dist/extension.js`,
   `dist/webview/main.js`, `dist/webview/main.css`, `dist/webview/mermaid.js`,
   `dist/webview/codicons/codicon.css`, `dist/webview/codicons/codicon.ttf` —
   and reports anything missing or unexpected;
2. byte-compares the two builds per file (`Non-reproducible files: …`);
3. asserts the minified `main.css` still contains one representative rule per
   component (`#app{`, `.transcript{`, `.mermaid-block{`, `.history-panel{`,
   `.command-panel{`, `.composer-shell{`, `.modal-backdrop{`,
   `@media(max-width:320px)`), which catches a dropped `@import`;
4. exits 1 on any finding, otherwise prints
   "Production build is complete and reproducible."

Consequences for contributors: a new emitted file means updating the manifest; a
new CSS component file means adding its selector to `requiredCssRules`; a
non-deterministic build (timestamps, `Math.random`, map iteration order) fails CI.

## 3. npm scripts

```json
"build":           "node scripts/build.mjs",
"watch":           "node scripts/build.mjs --watch",
"clean":           "node scripts/build.mjs --clean",
"typecheck":       "tsc --noEmit",
"test:unit":       "node --test test/unit/host/*.test.mjs test/unit/shared/*.test.mjs test/unit/webview/*.test.mjs test/integration/*.test.mjs",
"test":            "npm run typecheck && npm run test:unit",
"check:generated": "node scripts/check-generated.mjs",
"verify":          "npm run typecheck && npm run test:unit && npm run check:generated",
"package":         "npm run typecheck && npm run test:unit && node scripts/build.mjs --production && vsce package --no-dependencies",
"vscode:prepublish": "node scripts/build.mjs --production",
"preview":         "npm run build && node scripts/preview.mjs",
"test:rpc":        "node scripts/rpc-smoke.mjs"
```

- `test:unit` is broader than its name: it also runs `test/integration/*`.
- `package.json` has **no `dependencies` field**; `marked`, `dompurify`,
  `mermaid`, `highlight.js`, and `marked-cjk-friendly` are devDependencies
  bundled into the Webview output, which is why vsce runs with
  `--no-dependencies`. Do not move them to `dependencies`.
- A `knip` config exists but `knip` is not installed and has no script — treat it
  as inert, not as a gate.
- `npm run preview` is a devtool (headless-Chrome screenshot with faked
  `acquireVsCodeApi()` and injected `--vscode-*` variables). It is not part of
  the gate and is not shipped.

## 4. CI

[.github/workflows/ci.yml](../../../.github/workflows/ci.yml):

| Job | Runner | Command | Purpose |
|-----|--------|---------|---------|
| `verify` | ubuntu-latest | `npm ci` → `npm run verify` | The gate |
| `verify-windows` | windows-latest | `npm ci` → `npm run verify` | Executes `windowsPiLaunch.ts`, the non-POSIX process-tree kill, and Windows path handling |
| `package` | ubuntu-latest (needs `verify`) | `npm ci` → `npm run package` | Proves the `files` allowlist, `main` entry, and production build on every PR |

## 5. Requirements

Node.js 22, npm, VS Code `^1.129.0`, and (for manual runtime testing) a real `pi`
binary. Install with `npm ci` — the lockfile pins exact versions.

## 6. Checklist for build-adjacent changes

- [ ] New entry/output registered in `scripts/build.mjs` **and** the manifest in `check-generated.mjs`.
- [ ] New CSS file imported from `webview/main.css` before `responsive.css`, and added to `requiredCssRules` if it is a component.
- [ ] No non-deterministic content (timestamps, random ids) in emitted code.
- [ ] `npm run verify` passes; `npm run package` still produces a VSIX if you touched `files`/`main`.
- [ ] `CHANGELOG.md` updated for user-visible changes.
