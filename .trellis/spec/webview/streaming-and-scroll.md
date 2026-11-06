# Streaming, Transcript, and Scroll

> These invariants were learned from visible bugs: whole-transcript rebuilds,
> scroll fights during streaming, expanded tool bodies collapsing, and huge
> sessions freezing the panel. Each one is documented in the source with the
> failure mode it prevents. Do not "simplify" them.

---

## When this applies

Any change to transcript rendering, streaming deltas, message identity, scroll
behavior, disclosure, or the composer's follow-bottom behavior.

---

## 1. One keyed node per message; rebuild only on signature change

[transcript/transcriptView.ts](../../../webview/transcript/transcriptView.ts)
keeps one slot per message, keyed by `TranscriptEntry.key`, and reuses the node
when `signature` is equal.

- The key **must not change while the message stays in the transcript** — changing
  it rebuilds the node and drops expanded/selection state.
- Returning `previous` from `createNode` means "patch in place"; the view must not
  re-insert it, which would detach it from the DOM.
- Only a signature change justifies re-parsing markdown and re-sanitizing.

## 2. Message identity is inherited across mutated message objects

`WeakMap<PiMessage, MessageIdentity>` with `key` + `version`
([transcript/messageIdentity.ts](../../../webview/transcript/messageIdentity.ts)).
When a new object replaces the streaming one, `inherit()` bumps the version so the
node is patched rather than rebuilt.

Snapshots adopt identity **before** swapping the array
(`session/controller.ts`: "Identity must be adopted against the old array, before
installing the snapshot"). Getting this order wrong turns every snapshot into a
full rebuild and loses scroll position.

## 3. Streaming text appends; it does not re-render

`patchStreamingMessage` ([transcript/dom.ts](../../../webview/transcript/dom.ts))
compares `data-section-key` and `data-section-hash` per section, then appends the
suffix to the last text node (or code tail). A full re-parse is the fallback,
because "streaming hashes sample edges; equal-length corrections still need a full
text comparison".

## 4. Playback decouples network cadence from paint cadence

[transcript/streaming.ts](../../../webview/transcript/streaming.ts):

- The authoritative message receives deltas immediately.
- The displayed message approaches that target over several animation frames, so a
  bursty provider does not produce bursty paints.
- Playback knows nothing about scroll position: reading older content can stop
  viewport following without pausing playback.
- `finish()` keeps the authoritative message hidden until its buffered text is
  visible — no jump at the end of a reply.
- A live turn's process handle is open and a settled one is closed, unless the
  reader toggled it. The choice is stored per turn in the controller
  (`setTurnProcess`), so a slot rebuilt mid-stream comes back in the same state;
  see [state-and-rendering.md](./state-and-rendering.md) §10.

## 5. Follow-bottom is intent-based, not distance-based

[transcript/scrollAnchor.ts](../../../webview/transcript/scrollAnchor.ts):

- A distance threshold alone cannot express "did the reader leave?", because every
  gesture starts from the bottom. Intent is tracked explicitly: an upward wheel or
  touch drag detaches immediately.
- `bottomThresholdPx` stays small (4 px).
- "Did we cause this scroll?" is decided by comparing against `expectedScrollTop`
  within `PROGRAMMATIC_TOLERANCE_PX = 1` ([scrollAnchor.ts:63](../../../webview/transcript/scrollAnchor.ts)).
  One unexpected scroll during an animation is absorbed; a second hands the
  viewport to the reader.
- `stickToBottomIfFollowing()` reads back the applied offset, so a clamped value
  still counts as ours.
- Scroll metrics are measured **only after** following is confirmed: reading them
  forces layout, and a pass where the reader scrolled away does not owe one.

## 5b. A history rewrite is not navigation

Delete / edit / regenerate rebuild the branch into a new pi session file and
switch pi onto it, so the snapshot that follows carries a **different
`sessionId` for the same conversation**
([host/session-history.md](../host/session-history.md)).

- `SessionController.applySnapshot` therefore computes `sessionChanged` from
  `sessionId` inequality **minus** `message.historyRewritten`, which only the
  host's rewrite path sets. Without that marker the webview tears the
  transcript down and snaps to the newest message, which is exactly what a
  reader editing one turn does not want.
- A rewrite keeps the surviving nodes: identity is adopted by serialized
  content, so reopened reasoning and tool cards survive, and `transcriptView`
  removes the two or three rows that are actually gone.
- Navigation — the session picker, a fork, a fresh session — arrives without the
  marker and must still land on the latest message. Both directions are pinned
  by `test/unit/webview/scroll-after-rewrite.test.mjs`.
- The marker is a parameter of `refreshSnapshot(options)`, never instance state:
  a leaked flag would silently convert the next real switch into "stay put".


## 6. Pin only after all regions write DOM

The render pipeline ends with `stickToBottomIfFollowing()` then
`syncJumpToBottomButton()` then `scheduleTranscriptMeasure()`. Pinning earlier
measures a half-written DOM and produces a one-frame jump. See
[state-and-rendering.md](./state-and-rendering.md).

## 7. Big first builds are staged tail-first

[transcript/progressiveWindow.ts](../../../webview/transcript/progressiveWindow.ts),
instantiated as `new ProgressiveWindow({ threshold: 60, initial: 40, chunk: 40 })`:

- The first pass renders the tail — what the reader actually lands on.
- The rest backfills a window at a time, above the fold, so a reader at the bottom
  never sees the transcript move.
- The window is always a **suffix**.
- A hard render cap (`limit = 150`) adds a `history-omitted` entry carrying
  `omittedMessageCount` from the host.

## 8. Local reflows compensate scroll; they do not detach

Disclosure toggles call `anchor.detach()`, then
`restoreThinkingAnchor(offset => anchor.adjustBy(offset))`, measuring the same
element before and after. `adjustBy` records the assignment as programmatic so its
scroll event is not mistaken for reader input.

## 9. Anti-patterns

| Anti-pattern | Symptom it reintroduces |
|--------------|-------------------------|
| Rebuilding the transcript on each render | Dropped expanded state, lost selection, scroll jumps |
| Regenerating a message key on patch | Node rebuild; the reader's position is lost |
| Rendering a delta synchronously per event | Bursty paints during fast streaming |
| `scrollTop = scrollHeight` on new content | Fights the reader whenever they scroll up mid-stream |
| Distance-from-bottom as the only follow signal | Follow restarts on every gesture that begins at the bottom |
| Pinning before the composer/header render | One-frame jump, measurement thrash |
| Raising `PROGRAMMATIC_TOLERANCE_PX` to silence a jump | Hides real reader scrolls and makes detach unreliable |
| Rendering the full history on open | Multi-second stall on large sessions |

## 10. Tests that pin these invariants

Run these before touching this area:

```powershell
node --test test/unit/webview/transcript-view.test.mjs test/unit/webview/transcript-controller.test.mjs `
  test/unit/webview/scroll-anchor.test.mjs test/unit/webview/streaming.test.mjs `
  test/unit/webview/progressive-window.test.mjs test/unit/webview/scroll-recovery.test.mjs `
  test/unit/webview/smooth-follow.test.mjs test/unit/webview/submit-follow.test.mjs
```

Plus the browser-level check (needs Chrome, skipped otherwise):
[test/integration/webview-browser.test.mjs](../../../test/integration/webview-browser.test.mjs).
