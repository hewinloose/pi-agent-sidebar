# Layer Boundaries

> Import direction is the load-bearing architecture rule in this repository.
> It is not enforced by `tsc`: `tsconfig.json` includes `src/`, `webview/`, and
> `shared/` in one program with both `"DOM"` and `["node", "vscode"]` types, so a
> forbidden import still compiles. It is held by review and by the rules below.

---

## When this applies

Any change that adds an import, a new module, or moves code between layers.

## The import matrix

Verified by reading every `import` under `src/`, `shared/`, and `webview/`:

| Layer | Directory | May import |
|-------|-----------|------------|
| Protocol / portable helpers | `shared/` | only `./` siblings, with a `.js` suffix |
| pi transport + validation | `src/rpc/` | `node:*` and `../../shared/*` — **never `vscode`** |
| Domain services | `src/services/` | `node:*`, `shared/`, sibling services; `vscode` only where the editor API is genuinely required |
| UI / orchestration | `src/provider/` | `../rpc/*`, `../services/*`, `../../shared/*`, `vscode`, `../webviewDocument.js` |
| Activation | `src/extension.ts` | only `vscode` and `./provider/piViewProvider.js` |
| Browser UI | `webview/` | `../shared/*`, browser packages; **never `src/`** |

### Rule 1 — `shared/` is platform-neutral

No npm package, no `vscode`, no `node:*`, no direct DOM global. Verify with:

```powershell
Select-String -Path shared/*.ts -Pattern 'from "[^.]'
```

It must return nothing. Shared modules are imported by the extension host, the
Webview, and Node tests, so they must run in all three.

Helpers land in `shared/` only because both runtimes need the *same* rule, and
the doc comments record the drift that forced it: [jsonValues.ts](../../../shared/jsonValues.ts)
("three byte-identical copies had already accumulated") and
[messageContent.ts](../../../shared/messageContent.ts) ("a second copy of this
rule would drift"). Do not create a `shared/` helper for one caller.

### Rule 2 — `src/rpc/` never imports `vscode`

The transport is deliberately editor-agnostic so it can be driven by a real
child process in tests. Consequences to preserve:

- Event sources expose closure unsubscribers, not `vscode.Disposable`:
  `onEvent(): () => void` ([piRpcClient.ts:51](../../../src/rpc/piRpcClient.ts)).
- Platform-specific launch logic is isolated behind an injectable interface:
  `WindowsPiLaunchDeps` ([windowsPiLaunch.ts:26](../../../src/rpc/windowsPiLaunch.ts)).
  Same pattern for filesystem policy: `MediaPathResolver`
  ([transcriptMedia.ts:44](../../../src/services/transcriptMedia.ts)).
- Tests therefore need no `vscode` shim for this layer.

### Rule 3 — services do not know about the provider

`src/services/**` must not import `../../src/provider/*` or `src/rpc/*`, and
`src/extension.ts` must not reach into `rpc/` or `services/`. Verify:

```powershell
Select-String -Path src/services/*.ts -Pattern 'from "\.\./(provider|rpc)/'
```

The provider wires services together; services stay leaf nodes.

### Rule 4 — the Webview never imports host code

`webview/**` must not import `src/**`. Verify:

```powershell
Select-String -Path webview/*.ts,webview/**/*.ts -Pattern 'from "(\.\./)*src/'
```

Anything both halves need moves to `shared/`.

### Rule 5 — HTML and CSP have exactly one owner

`src/webviewDocument.ts` sits at the `src/` root (not under `provider/`) and is
the only place that builds the document shell, asset URIs, and the Content
Security Policy. The Webview assumes that shell exists — it resolves element ids
with `element<T>(id)` and throws `Missing #id` when markup drifts
([webview/main.ts](../../../webview/main.ts)).

### Rule 6 — extract pure policy instead of testing the provider

Provider logic that is decidable without VS Code lives in small pure modules
next to it, so it can be bundled and tested in isolation:

| Module | Exported decision |
|--------|-------------------|
| [deliveryPolicy.ts](../../../src/provider/deliveryPolicy.ts) | `streamingBehaviorFor(...)` |
| [notificationPolicy.ts](../../../src/provider/notificationPolicy.ts) | `notificationDestination(...)` |
| [sessionMutation.ts](../../../src/provider/sessionMutation.ts) | `sessionMutationBlockReason(...)`, `assertSessionMutationAllowed(...)` |
| [missedReplies.ts](../../../src/provider/missedReplies.ts) | `isReplayableReply(...)`, `MAX_MISSED_REPLIES` |

When new provider logic is a decision table rather than a side effect, put it in
a module like these and test that module directly.

---

## Anti-patterns

| Anti-pattern | Why it is wrong here |
|--------------|----------------------|
| `import * as vscode from "vscode"` inside `src/rpc/` or `src/services/` core modules | Breaks the child-process tests and the platform-neutral transport |
| Re-exporting a `vscode` type through `shared/protocol.ts` | Makes the protocol unloadable in the browser |
| A `webview/` module importing `src/` logic to reuse it | Ships host code into the browser bundle; move the shared part to `shared/` |
| Adding a helper to `shared/` for a single caller | The rule then has two homes and will drift |
| Recomputing a value pi already returns (diffs, file contents, token usage) | Violates the thin-client rule in [AGENTS.md](../../../AGENTS.md); forward pi's payload instead |
| Constructing a document/asset URI outside `src/webviewDocument.ts` | CSP and `asWebviewUri` rules diverge silently |

---

## Checklist for adding a module

- [ ] Placed in the layer that owns its responsibility (transport, service, provider, Webview, shared).
- [ ] Imports respect the matrix above; run the three `Select-String`/`grep` checks for your change.
- [ ] If it touches `vscode` and is also needed in tests, split the decision into a pure module.
- [ ] If both halves need it, it is in `shared/` and imports nothing external.
- [ ] A test exists at `test/unit/{host,shared,webview}/<kebab-name>.test.mjs` (see [quality/testing.md](../quality/testing.md)).
