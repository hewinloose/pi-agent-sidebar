# Webview Boundary (host side)

> Everything that enters or leaves the Webview crosses one of two chokepoints.
> Adding a listener, a message type, or a DOM update outside them is the most
> common way to break this project.

---

## When this applies

Any change to Webview → host messages, host → Webview messages, status bar
updates, or what the provider does when the view is hidden or disposed.

---

## 1. Inbound: one listener, one parser

- The provider registers exactly one message listener on the view
  (`onDidReceiveMessage`), and the first thing it does is
  `parseWebviewMessage(value)` ([shared/protocolParser.ts:17](../../../shared/protocolParser.ts)).
- The parser returns `undefined` for anything invalid; the caller logs
  `"[webview] Ignored an invalid message."` and returns. Host code never sees a
  partially-bounded payload.
- Dispatch is `switch (message.type)` in
  [webviewMessageRouter.ts](../../../src/provider/webviewMessageRouter.ts), ending
  with `default: assertNever(message)` ([line 134](../../../src/provider/webviewMessageRouter.ts)).
- The router is stateless: one flat `WebviewMessageRouterOptions` object of
  `onXxx(): Promise<void>` callbacks, wired in the provider constructor. Adding a
  message means adding a callback there and implementing it in the provider.
- Messages carrying `actionId` are dispatched through `respondToAction`, which
  guarantees exactly one `actionResult` reply.

## 2. Outbound: one `post()`

- Every host → Webview message goes through
  `private async post(message: HostToWebviewMessage): Promise<boolean>`
  ([piViewProvider.ts:1717](../../../src/provider/piViewProvider.ts)). It handles
  the hidden-view case, returns whether the message was delivered, and updates the
  status bar. **Nothing else may call `webview.postMessage`.**

  The type is `Promise<boolean>`, so callers can tell a drop from a delivery; do
  not change it to `void` without checking every call site.
- A hidden view refuses delivery. `post()` then sets `missedPostWhileHidden` (the
  next reveal resyncs) and queues replies the Webview cannot ask for again
  through `missedReplies` / `isReplayableReply`, bounded by `MAX_MISSED_REPLIES`
  (32). Overflow is logged, not thrown. Do not bypass this by posting directly.
- `post()` also drives the status bar from message type: `connection` (phase),
  `bootstrap` with `phase: "no-workspace"`, and `snapshot` (ready).
- Message ordering matters: a full snapshot must not be interleaved with deltas.
  Reuse the existing post path rather than adding an independent pump.
- Replies that arrive after the view is disposed are dropped by the runtime, not
  thrown into the provider.

## 3. Message shapes

- Every shape is declared in `shared/protocol.ts`; the browser dispatch is
  [webview/hostMessageHandler.ts](../../../webview/hostMessageHandler.ts) with the
  same `assertNever` tail.
- Unknown **pi** event types are forwarded on purpose: the reducer keeps a
  forward-compatible fallback rather than failing on a new event name. Do not add
  a strict validator for pi events inside the Webview — use `jsonValues.ts`.
- Bounds live with the protocol (`MAX_*`), not in the provider.

## 4. Transport state vs. UI state

The host is authoritative for session data, the Webview for transient UI:

- Host sends: state/snapshot sections, messages, connection phase, notices,
  action results, session lists, media sources, mention suggestions.
- Webview owns: scroll position, disclosure/expand state, draft text, hover and
  focus, transient status text.

Concretely: `setStatus` from pi is intentionally **not** forwarded
([extensionUiController.ts](../../../src/provider/extensionUiController.ts)) — the
Webview renders its own transient status. Do not add a host message for something
the Webview can decide from data it already has.

## 5. Lifecycle coupling

- The view-scoped `onDidDispose` disposes the message listener, the visibility
  listener, and itself.
- Visibility changes stop/start expensive work (status bar, queue flushing); they
  must not restart the pi runtime.
- After a runtime restart, the provider re-posts a fresh snapshot instead of
  patching the old one. The Webview's `SessionController` adopts identity before
  swapping arrays (see [webview/state-and-rendering.md](../webview/state-and-rendering.md)).

## 6. Adding a message — host-side checklist

- [ ] Union member + `MAX_*` in `shared/protocol.ts`.
- [ ] Parser branch in `shared/protocolParser.ts` (returns `undefined` on bad input) or the pi `parse*` if it originates from pi.
- [ ] `WEBVIEW_REQUEST_TYPES` updated when the Webview initiates it.
- [ ] Router callback in `webviewMessageRouter.ts` + implementation in `piViewProvider.ts`, or a `case` in `webview/hostMessageHandler.ts`.
- [ ] Sent through `post()`; received through the single listener.
- [ ] Test in `test/unit/shared/protocol.test.mjs` and, for behavior, the matching host/webview suite.

## 7. Anti-patterns

| Anti-pattern | Why |
|--------------|-----|
| A second `webview.onDidReceiveMessage` | Bypasses the parser and the `assertNever` dispatch |
| `webview.postMessage(...)` called directly | Skips the hidden-view guard and status-bar update |
| Answering an `actionId` message twice, or not at all | Double-handles or hangs the renderer's pending action |
| Validating pi events strictly in the Webview | Breaks forward compatibility with new pi releases |
| Putting transient UI state on the host | Duplicates ownership; the Webview already owns it |
| Passing display labels instead of URIs to the Webview | Breaks local/remote/multi-root workspaces (see [CONTRIBUTING.md](../../../CONTRIBUTING.md)) |
