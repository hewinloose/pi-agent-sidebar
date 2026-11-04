# Architecture Specs

> Cross-layer rules that no single directory owns. Read these before adding a
> module, an import, or a protocol field.

---

## Files

| File | Answers |
|------|---------|
| [layer-boundaries.md](./layer-boundaries.md) | Which layer may import which, and how platform-specific code is isolated |
| [protocol-and-validation.md](./protocol-and-validation.md) | How host and Webview talk, and how untrusted data is validated |

---

## When to read this directory

- You are adding a new file and need to know where it belongs.
- You are adding a field or message type to `shared/protocol.ts`.
- You are tempted to import `vscode`, a Node built-in, or an npm package from somewhere new.
- A reviewer says "this should be a pure function" or "this crosses the boundary wrong".

---

## The one design rule everything else follows

From [CONTRIBUTING.md](../../../CONTRIBUTING.md) and [AGENTS.md](../../../AGENTS.md):

> The extension is a thin client around pi. Do not reimplement agent behavior,
> and do not depend on pi's private implementation details.

Practical test for a new feature: its correctness may depend on the VS Code API
and pi's **public RPC protocol**, never on how pi happens to work internally.
Consume what pi sends (`result.details.diff`, `get_state`, `get_messages`,
events) and render it; do not recompute it client-side.

---

## Layer map in one table

| Layer | Directory | Runtime |
|-------|-----------|---------|
| Protocol types and portable helpers | `shared/` | VS Code host, Webview, Node tests |
| pi transport + response validation | `src/rpc/` | Extension host (Node) |
| Domain services | `src/services/` | Extension host (Node) |
| UI orchestration / provider | `src/provider/`, `src/extension.ts` | Extension host (VS Code API) |
| Browser UI | `webview/` | Webview (browser) |

Details, allowed import directions, and the exceptions are in
[layer-boundaries.md](./layer-boundaries.md).
