# State and Rendering

> There is no store, no framework, and no subscription. State is a mutable object,
> renders are requested explicitly, and each region protects itself with a
> signature. This file explains that contract.

---

## When this applies

Adding UI state, wiring a new host message or pi event into the UI, adding a
render pass, or debugging "the UI updated twice / did not update".

---

## 1. One state object, two writers

- [webview/app/state.ts](../../../webview/app/state.ts) declares the `UiState`
  shape; it contains no logic.
- [webview/main.ts:83](../../../webview/main.ts) owns the only instance
  (`const ui = createUiState();`).
- Exactly two modules may write authoritative data:
  - `SessionController` — authoritative snapshots (new session, restore, fork).
  - `RpcEventReducer` — pi RPC events, "reduces pi RPC events into Webview state
    and schedules the smallest UI update"
    ([rpcEventReducer.ts](../../../webview/rpcEventReducer.ts)).
- `HostMessageHandler` dispatches `HostToWebviewMessage` into callbacks "without
  knowing the Webview's state model"
  ([hostMessageHandler.ts:22](../../../webview/hostMessageHandler.ts)). New host
  messages are handled there, never by reaching into `ui` from the handler.
- `main.ts` is the composition root: it wires controllers, renders, and listeners,
  but does not become a third owner of session data.

If you need a new writer, that is an architectural change — route it through one
of the three modules above instead.

## 2. Re-render is requested, never observed

- State is a plain mutable object (`options.ui.busy = true`); renderers read the
  same object at render time (`createHeaderRenderer({ elements, state: ui })`).
- Components take a scheduling callback, not a subscription:
  `scheduleRender()` / `invalidate()` in their options.
- `scheduleRender()` funnels into `FrameCoordinator`, which coalesces
  measure/advance/transcript-render/render plus a scroll task into **one** native
  frame. It captures pending flags before running any phase, so work requested by
  a later phase goes to the next frame instead of running after its own DOM writes.

## 3. The render pipeline is a fixed order

`render()` ([webview/main.ts:1129](../../../webview/main.ts)) calls, in order:

1. `headerRenderer.render()`
2. `transcriptController.render()`
3. `restoreThinkingAnchor(...)`
4. composer renderers
5. `finishRender()`
6. `refreshRelativeTimes()`
7. `refreshElapsedLabels()`
8. `scrollAnchor.stickToBottomIfFollowing()`
9. `syncJumpToBottomButton()`
10. `scheduleTranscriptMeasure()`

Pinning happens **last** because it must run after every region has written DOM
and time labels. Adding a render step means placing it deliberately in this
sequence, not calling it from an arbitrary listener.

`refreshElapsedLabels()` owns its own one-second timer and rewrites running tool
labels in place. It must never feed the render signature: a counter that forced a
re-render every second would rebuild the very node it is printed in.

## 4. Idempotence by signature

The core idiom: compute a string signature, compare with the module-level
`lastSignature`, return early when equal.

```ts
// composer/renderer.ts:47
const signature = ui.attachments.map((i) => `${i.id}:${i.kind}:${i.label}:${i.path}`).join("\u0000");
if (signature === attachmentSignature) return;
attachmentSignature = signature;
```

- Signatures are `"\u0000"`-joined strings. Never `JSON.stringify` a whole object —
  key order makes it unstable and it allocates per frame.
- Include every field that changes the DOM, and nothing else. Missing a field
  freezes the region; an unstable field re-renders every frame.
- Same pattern exists in `renderComposerHighlights`, `reflowComposerTools`, and
  structurally in the transcript (`TranscriptEntry.signature`).

## 5. Persisted state is minimal and validated

Only the draft and composer references are persisted
(`vscode.setState({ draft, composerReferences })`), and they are parsed through
`parsePersistedReferences` on the way back in. Never persist derived UI or secret
data; a Webview reload must behave like a fresh render with the same inputs.

## 6. Error containment

- Unknown **pi** event types must not throw: the reducer keeps a
  forward-compatible fallback so a new pi release never blanks the transcript.
- A failed host action surfaces as `actionResult` (`ok: false`), which the pending
  action registry turns into a local error state.
- Render paths never `throw` on missing data; they render nothing for that section.

## 7. Anti-patterns

| Anti-pattern | Consequence |
|--------------|-------------|
| Adding an event emitter / store | Duplicates `FrameCoordinator`; reintroduces ordering bugs |
| Rendering from a DOM listener directly | Skips the frame coalescing; causes layout thrash |
| `innerHTML` or `insertAdjacentHTML` | Bypasses the sanitizer policy (see [dom-and-styles.md](./dom-and-styles.md)) |
| `JSON.stringify` as a render signature | Unstable key order, per-frame allocation |
| Reading `ui` inside `HostMessageHandler` | Breaks the "handler knows no state model" boundary |
| Rebuilding the transcript array on every delta | Destroys scroll position and node identity; see [streaming-and-scroll.md](./streaming-and-scroll.md) |
| Persisting derived state | Stale UI after reload; validation surface grows for no benefit |

## 8. A long-running tool must show that it is alive

A `trellis_subagent` call once ran three parallel research children for ~8
minutes. The card showed only a breathing border, the reader could not tell it
apart from a hang, and stopping the turn looked like the only way out — the work
had already finished when the abort landed 6 ms after the tool result.

Two things now hold a running call open:

- **Elapsed time.** `toolCallHtml` emits `<span class="tool-elapsed"
  data-started-at="<epoch>">` ahead of the `output` hint while
  `resolveToolStatus()` says `running` and `live.startedAt > 0`.
  `toolDuration.ts` formats it (`12s` / `1m 05s` / `1h 02m`); a call under
  `ELAPSED_MIN_MS` shows nothing, and a synthesised start time of 0 renders
  nothing so replayed history never claims a 59-year duration.
- **In-place refresh.** `refreshElapsedLabels()` in `main.ts` rewrites the
  label's `textContent` once a second from the existing frame ticker. It must
  stay out of the render signature: routing it through the renderer would
  rebuild, once per second, the very node the label lives in. The timer only
  arms while at least one `[data-started-at]` exists.

The tool that dispatches sub-agents also takes a caller-chosen `timeoutSeconds`
(default 600, max 900) and kills the child at the deadline, returning the partial
output. That belongs to the extension in `.pi/`, not to this Webview: pi's `abort`
waits for the session to go idle, which a blocking tool never lets happen.

Tool `details` other than `details.diff` are still dropped, deliberately. If a
progress payload such as `trellis-subagent-progress` is ever rendered, give it a
validated shape in `shared/protocol.ts` first — do not pass raw `details` through
to the DOM.

## 9. Row actions address prompts by session-wide ordinal

Delete / edit / regenerate / fork are rendered by `messageActionsHtml` as
`[data-message-action]` buttons carrying `data-prompt-ordinal`. A reply's row
also carries Copy, first in the row (复制 · 从此回复创建分支 · 重新生成), and it
addresses a message rather than a prompt: `data-copy-key` holds the row's
transcript key, and `TranscriptController.copyTextFor()` resolves it to pi's own
answer text. Copy therefore needs no ordinal — it stays available on a row whose
opening prompt fell outside the window, and while a turn is running. The four
history buttons are always in the DOM; the handler refuses them while pi is busy,
so a stream start never rebuilds a row.
The ordinal is computed by `TranscriptController.promptOrdinals()` over the whole
snapshot — **not** the rendered window — and offset by
`state.omittedPromptCount`, which the host supplies because a windowed snapshot
drops prompts the Webview cannot count. The host re-checks the prompt text before
acting, so a stale ordinal fails closed instead of taking out a neighbouring
turn. See [host/session-history.md](../host/session-history.md).
