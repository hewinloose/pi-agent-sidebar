# Provider and Lifecycle

> `src/provider/piViewProvider.ts` is the composition root of the extension. Most
> host-side rules exist to keep it correct under concurrent user actions,
> workspace changes, and runtime restarts.

---

## When this applies

Any change to activation, the provider, a service it wires, or anything that can
run concurrently with a session mutation or a runtime restart.

---

## 1. Activation is thin

[src/extension.ts](../../../src/extension.ts) is the only place that registers
commands, creates the output channel and status bar, and it delegates:

- Command handlers are one-liners that call a `PiViewProvider` method.
- Every registration is pushed into **one** `context.subscriptions` call.
- Command ids live in `package.json` and are pinned by
  [test/integration/manifest.test.mjs](../../../test/integration/manifest.test.mjs).
- Fire-and-forget handlers are wrapped and surface failures:
  `provider.renameSession().catch((error: unknown) => { void vscode.window.showWarningMessage(...) })`.
- `deactivate()` awaits `provider.shutdown()`.

Do not add transport or filesystem logic to `extension.ts`; it may only reach the
provider (see [architecture/layer-boundaries.md](../architecture/layer-boundaries.md)).

## 2. Provider structure

- Constructor wires the message router with one options object of
  `onXxx(): Promise<void>` callbacks
  ([piViewProvider.ts:219](../../../src/provider/piViewProvider.ts),
  [webviewMessageRouter.ts:7](../../../src/provider/webviewMessageRouter.ts)).
  The router itself holds no state.
- All outbound Webview traffic goes through the single private
  `post(message: HostToWebviewMessage)` method
  ([piViewProvider.ts:1717](../../../src/provider/piViewProvider.ts)), which also
  updates the status bar and drops messages when the view is hidden. Nothing else
  may call `webview.postMessage`.
- Actions carrying an `actionId` go through `respondToAction`, which always posts
  back `{ type: "actionResult", actionId, ok, cancelled?, error? }`.

## 3. Disposal

The provider implements `vscode.Disposable` **and** exposes an idempotent
`shutdown()` memoized in `shutdownPromise`
([piViewProvider.ts:637](../../../src/provider/piViewProvider.ts)):

```ts
public shutdown(): Promise<void> {
  if (this.shutdownPromise) return this.shutdownPromise;
  this.disposed = true;
  this.shutdownPromise = (async () => { /* ... */ })();
  return this.shutdownPromise;
}

public dispose(): void { void this.shutdown(); }
```

- New teardown work goes inside the async body of `shutdown()`, never in `dispose()`.
- Services that hold `vscode` listeners implement `vscode.Disposable` and collect
  children in a `disposables: vscode.Disposable[]` array
  ([workspaceFileSearch.ts](../../../src/services/workspaceFileSearch.ts)).
- Expensive listeners are created lazily on first use, not in the constructor.
- View-scoped listeners chain to the view: `onDidDispose` disposes the message
  listener, the visibility listener, and itself.
- Idempotency is **promise-memoized**, not boolean-flagged: `startPromise`,
  `shutdownPromise`, `initializationPromise`, `cached`.

## 4. Concurrency and staleness

Two mechanisms, both required for session-mutating work.

**Serialization.** Session mutations run through `AsyncQueue`
([asyncQueue.ts](../../../src/provider/asyncQueue.ts)) via
`enqueueSessionMutation(operation, { requireIdle })`
([piViewProvider.ts:968](../../../src/provider/piViewProvider.ts)). The helper
captures `workspaceGeneration`, increments `sessionMutationPending`, and
re-asserts context around every await. `assertNoSessionMutationPending()`
([piViewProvider.ts:1021](../../../src/provider/piViewProvider.ts)) guards double
submits of new/clone/fork.

**Generation counters.** `workspaceGeneration` ([piViewProvider.ts:150](../../../src/provider/piViewProvider.ts))
is bumped on workspace change and shutdown; `snapshotSequence`
([piViewProvider.ts:151](../../../src/provider/piViewProvider.ts)) drops late
snapshots. Every async step re-checks the generation and returns early. Client
identity is re-checked on every listener (`if (this.client !== client) return;`),
and `ExtensionUiController` uses `isCurrentClient`.

**Partial failure.** Runtime startup gathers state with `Promise.allSettled` and
per-result fallback; only `get_state` and `get_messages` are hard requirements.
A failed optional section renders as absent, not as a blank sidebar.

Rule of thumb: if new async work can outlive a restart or a workspace switch, it
needs a generation check; if it mutates the session, it goes through the queue.

## 5. Error handling

- **No Result/Either types in the host.** Throw `new Error("...")`, catch at
  boundaries. The only result-like shape is the Webview `actionResult`.
- Sentinel subclasses are caught with `instanceof`:
  - `RuntimeUnavailableError` ([piViewProvider.ts:119](../../../src/provider/piViewProvider.ts)) — swallowed; the view already shows connection state.
  - `SessionMutationCancelledError` ([piViewProvider.ts:126](../../../src/provider/piViewProvider.ts)) — becomes `actionResult { ok: true, cancelled: true }`.
  - `ProtocolValidationError` — logged; invalid events are dropped.
- Never `throw` a non-`Error`. Validators return strings/`undefined`; they do not
  throw on the Webview boundary.
- `toErrorMessage(error: unknown)` is re-declared per module on purpose; the
  narrowing idiom is `error instanceof Error ? error.message : String(error)`.
  Do not centralize it into `shared/` just to deduplicate four lines.

## 6. User-facing failure channels

Three channels, chosen deliberately — pick the narrowest one that fits:

| Channel | Use for | Example |
|---------|---------|---------|
| `actionResult` | A Webview-initiated command failed but the session is fine | A refused `mailto:`, a path outside the workspace, a missing workspace folder |
| `{ type: "connection", phase: "error" }` | The runtime is unusable | pi failed to start / exited |
| `{ type: "notice", kind: "error" }` | Non-fatal background problem | Auxiliary RPC or media failure |
| `vscode.window.showWarningMessage` | Command-palette initiated failures | Rename session from the palette |
| `output.appendLine` only | Background failure with no user action behind it | Snapshot section unavailable |

The `connection` channel used to carry ordinary command failures and took the
whole sidebar down; that is the regression the split exists to prevent
(see the comment in [shared/protocol.ts](../../../shared/protocol.ts) around the
notice variant).

## 7. Logging

- Always `this.output.appendLine(\`[tag] ${detail}\`)` with exactly one bracketed
  subsystem tag: `[runtime]`, `[protocol]`, `[snapshot]`, `[webview]`,
  `[extension-ui]`, `[session]`, `[media]`, `[attachments]`, `[visibility]`.
- Child stderr is appended verbatim with `append` (partial lines), not `appendLine`.
- `void` marks deliberate fire-and-forget; give each one a `.catch` or a comment
  explaining why nothing can fail.

## 8. Path- and URI-safety suppression

Path traversals that are intentional carry an audit comment directly above the
call:

```ts
// pi-lens-ignore: ts-path-traversal -- <mandatory reason>
```

The reason is required. Suppressions without a reason are review blockers.

## 9. Checklist

- [ ] New command registered in `package.json` + `extension.ts` + `manifest.test.mjs`.
- [ ] New async work has a generation check and, if it mutates the session, an `enqueueSessionMutation` wrapper.
- [ ] Teardown added to `shutdown()`'s async body, not `dispose()`.
- [ ] Failures routed to the narrowest channel in the table above.
- [ ] Log lines carry a subsystem tag.
