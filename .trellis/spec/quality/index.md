# Quality Specs

> What "done" means in this repository: a reproducible production build, a green
> `npm run verify`, and code that matches the surrounding file rather than a
> formatter configuration.

---

## Files

| File | Answers |
|------|---------|
| [testing.md](./testing.md) | Runner, test layout, how `.mjs` tests load `.ts` modules, how to fake vscode / pi / the DOM |
| [build-and-release.md](./build-and-release.md) | The esbuild entries, the reproducible-build gate, the npm scripts, and CI |
| [code-style.md](./code-style.md) | Formatting reality, type-safety rules, comment and naming expectations |

---

## The gate

`npm run verify` = `typecheck` + `test:unit` + `check:generated`. It is the
commit/PR gate ([CONTRIBUTING.md](../../../CONTRIBUTING.md)) and it runs in CI on
Ubuntu and Windows.

```powershell
npm run verify
```

There is no ESLint and no formatter step, so `typecheck` is the only automatic
style check. Anything a reviewer would call a style rule must be written down
here instead.

---

## Not part of the gate

| Command | Why it is opt-in |
|---------|------------------|
| `npm run test:rpc` | Needs a real `pi` binary on `PATH` (or `PI_BINARY`) |
| `npm run preview` | Headless-Chrome screenshot harness for Webview work |
| `test/integration/webview-browser.test.mjs` | `t.skip`s when no Chrome is available; must never hard-fail `verify` |

If your change cannot be covered automatically, describe the manual validation in
the PR (CONTRIBUTING.md), including a screenshot or recording for UI changes.
