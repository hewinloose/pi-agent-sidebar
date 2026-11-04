# Six Chat Transcript Features

## Goal

Port six chat-transcript capabilities into the sidebar, using the approaches proven in `D:\code\PI-Desktop`.

1. Thinking blocks are collapsible: expanded by default, auto-collapsed once when a live reply finishes.
2. Delete a user message together with its reply.
3. Fork a new session from a specific reply.
4. Edit a user message.
5. Regenerate an assistant reply.
6. Show elapsed time for running tools (sub-agents included) and let the calling agent cut one off.

## Scope

- Source: `webview/`, `src/`, `shared/`, and the managed pi extension `.pi/extensions/trellis/index.ts`.
- Out of scope: revision history / undo pager, backfilling turns after a delete, cross-workspace sessions.

## Architecture Context

- pi's RPC has `fork` (user prompts only), `switch_session`, `get_fork_messages`, `get_entries`. There is **no** edit/delete/regenerate command, and `ctx.sessionManager` is read-only for extensions.
- The session file format is public and documented (JSONL v3, append-only tree keyed by `id` / `parentId`).
- `PiState.sessionFile` already exists and `switch_session` + `waitForSessionReplacement` are already implemented in the provider.
- Snapshots come from `get_messages` (windowed to 600) and carry no entry id; `get_fork_messages` is the only source of `entryId`.

Approved decisions:

- Delete/edit/regenerate rebuild a **new** session file and load it with `switch_session`. The original file is never modified, so switching back is the undo.
- Edit and regenerate truncate from the target user prompt and replay it.
- The sub-agent timeout is a `timeoutSeconds` parameter the calling agent sets; the tool kills the child process at the deadline and returns the partial output.

## Files To Create Or Update

- `src/services/sessionHistory.ts` (new, pure Node, no `vscode`)
- `webview/transcript/toolDuration.ts` (new, pure)
- `shared/protocol.ts`, `shared/protocolParser.ts`
- `src/provider/webviewMessageRouter.ts`, `src/provider/piViewProvider.ts`
- `webview/transcript/controller.ts`, `renderer.ts`, `dom.ts`
- `webview/main.ts`, `webview/styles/transcript.css`
- `.pi/extensions/trellis/index.ts`
- `.trellis/spec/host/session-history.md` (new), `.trellis/spec/webview/state-and-rendering.md`, `CHANGELOG.md`

## Rules

- Match the surrounding file's indentation; there is no formatter.
- Never rewrite a session file in place.
- Every protocol variant needs the union member, the parser branch, `WEBVIEW_REQUEST_TYPES`, both dispatch switches, and a test.
- Elapsed-time labels must stay out of the render signature.

## Acceptance Criteria

- [x] Thinking blocks render expanded; a finishing live reply collapses them once; an explicit user choice wins and survives later renders.
- [x] A running tool shows elapsed seconds; the label disappears when the call settles.
- [x] A user message can be deleted, taking its reply with it, while later turns survive.
- [x] A user message can be edited and re-run from the new text.
- [x] An assistant reply can be regenerated from its prompt.
- [x] A reply can fork a new session, which then becomes the active one.
- [x] `trellis_subagent` accepts `timeoutSeconds`, kills the child at the deadline, and reports the truncation.
- [x] `npm run verify` passes.

