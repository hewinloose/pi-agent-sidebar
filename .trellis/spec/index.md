# Pi Agent Sidebar — Project Spec

> Coding guidance for AI agents and contributors working in this repository.
> These files describe what the code **actually does today**, with real paths.
> When the code and the spec disagree, the spec is wrong — fix it in the same PR.

---

## What this project is

A VS Code extension that embeds the [pi](https://pi.dev) coding agent in the
auxiliary sidebar. It is a **thin client**: it renders pi's conversation in a
theme-aware Webview and feeds pi the context only VS Code has. It must not
reimplement pi's behavior or depend on pi's internals.

Read first: [AGENTS.md](../../AGENTS.md) (design principles and the litmus
test) and [CONTRIBUTING.md](../../CONTRIBUTING.md) (workflow, security rules,
PR expectations).

---

## Spec map

| Directory | Read it when |
|-----------|--------------|
| [architecture/](./architecture/index.md) | Adding a module or an import, or changing the host ⇄ Webview protocol |
| [host/](./host/index.md) | Working in `src/` — activation, provider, pi transport, services |
| [webview/](./webview/index.md) | Working in `webview/` — state, rendering, DOM, CSS, streaming, scroll |
| [quality/](./quality/index.md) | Writing tests, changing the build, or preparing a PR |
| [guides/](./guides/index.md) | Before coding anything non-trivial — cross-layer and code-reuse thinking guides |

### architecture/

| File | Content |
|------|---------|
| [layer-boundaries.md](./architecture/layer-boundaries.md) | Import matrix, the six layer rules, anti-patterns |
| [protocol-and-validation.md](./architecture/protocol-and-validation.md) | Protocol union, three validation modes, exhaustiveness gates, adding a variant |

### host/ (`src/`)

| File | Content |
|------|---------|
| [provider-and-lifecycle.md](./host/provider-and-lifecycle.md) | Activation, provider structure, disposal, concurrency, error channels, logging |
| [rpc-transport.md](./host/rpc-transport.md) | Spawn, newline framing, correlation, timeouts, staged shutdown |
| [webview-boundary.md](./host/webview-boundary.md) | The one inbound listener, the one outbound `post()`, state ownership |

### webview/ (browser)

| File | Content |
|------|---------|
| [state-and-rendering.md](./webview/state-and-rendering.md) | `UiState`, two writers, render pipeline, signature idempotence |
| [dom-and-styles.md](./webview/dom-and-styles.md) | Three DOM tiers, sanitizer policy, listeners, CSS tokens, `is-*` modifiers |
| [streaming-and-scroll.md](./webview/streaming-and-scroll.md) | Keyed transcript nodes, playback, intent-based follow-bottom, progressive window |

### quality/

| File | Content |
|------|---------|
| [testing.md](./quality/testing.md) | Node test runner, `loadBundledModule`, faking vscode / pi / DOM |
| [build-and-release.md](./quality/build-and-release.md) | esbuild entries, reproducible-build gate, npm scripts, CI |
| [code-style.md](./quality/code-style.md) | Formatting reality, type rules, naming, comment expectations |

---

## The rules that matter most

1. **Thin client.** Forward pi's output; never reimplement or depend on pi's
   internals. Correctness may depend on the VS Code API and pi's public RPC only.
2. **Layering is manual.** `tsc` cannot enforce it (one program, DOM + node +
   vscode types): `shared/` stays platform-neutral, `src/rpc/` never imports
   `vscode`, `webview/` never imports `src/`.
3. **Trust nothing at a boundary.** `unknown` + a bounded hand-written parser.
   Webview → host returns `undefined`; pi → host throws
   `ProtocolValidationError`; Webview event fields go through `jsonValues.ts`.
4. **One chokepoint per direction.** One inbound message listener + the router's
   `assertNever`; one outbound `post()`.
5. **Never `innerHTML`.** All HTML goes through `TRANSCRIPT_SANITIZE_OPTIONS`.
6. **Do not simplify the streaming/scroll invariants.** Each one exists because a
   visible bug shipped without it.
7. **Match the file you edit.** No formatter or linter exists; unrelated
   reformatting is a review blocker.

---

## Verification

```powershell
npm run verify        # typecheck + test:unit + reproducible-build check
npm run build         # development bundles
npm run preview       # headless-Chrome Webview preview (devtool, not a gate)
npm run test:rpc      # opt-in, needs a real pi binary
```

`npm run verify` is the commit/PR gate and runs in CI on Ubuntu and Windows.

---

## Maintaining this spec

- Add a rule only with evidence: a source file, a test, or a project document.
- Reference real paths; do not invent examples.
- Delete a rule when the code no longer does it — a stale spec is worse than a
  missing one, because agents copy it.
- Keep `index.md` files in sync with the files that exist.
