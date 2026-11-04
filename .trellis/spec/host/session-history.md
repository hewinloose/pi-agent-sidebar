# Session History Rewriting

> `src/services/sessionHistory.ts` is the only module that understands pi's
> session file. It exists because pi has no history-mutation RPC, and it enforces
> one rule above all others: **never rewrite the file pi is holding.**

---

## When this applies

Changing delete / edit / regenerate, adding another history operation, or
touching how the provider switches sessions after one.

---

## Why this exists

pi's RPC cannot remove or rewrite history:

| Capability | pi |
|------------|-----|
| Fork at a **user** prompt | `fork { entryId }` |
| Start a new session | `new_session`, `clone` |
| Switch sessions | `switch_session { path }` |
| Delete/edit a message | **none** |
| Mutable session manager for extensions | **none** — `ctx.sessionManager` is read-only |

So a deletion is expressed as a different tree: the module builds a corrected
session document, writes it to a **new** file, and the provider switches pi onto
it. The original keeps every entry it ever had, which makes switching back the
undo.

## The format

A session file is newline-delimited JSON (docs: `session-format.md`, v3):

```
{"type":"session","version":3,"id":"<uuid>","cwd":"...","timestamp":"..."}
{"type":"message","id":"a1b2c3d4","parentId":null,"timestamp":"...","message":{...}}
{"type":"message","id":"e5f6a7b8","parentId":"a1b2c3d4","timestamp":"...","message":{...}}
```

- The first line is a header with no `id`/`parentId` and is not part of the tree.
- Every later entry names its parent; the active branch is the chain from the
  newest unclaimed entry back to the root.
- Entry ids are the only durable cursor. `get_messages` does **not** expose them —
  `get_fork_messages` is the only public source, and it lists **user** prompts
  only.

## Rules

1. **Validate before deriving anything.** `readSessionDocument` checks the header
   type, `version === 3`, every entry's `id`/`parentId`, and rejects duplicate
   ids. `SUPPORTED_SESSION_VERSION` is the single knob; a newer pi fails closed
   instead of being mangled.
2. **Never write the source file.** `writeSessionDocument` writes a sibling and
   `rename`s it into place. Nothing in this module opens the original for
   writing.
3. **Record the lineage.** `withNewIdentity` sets a fresh `id`, a fresh
   `timestamp`, and `parentSession` = the original absolute path.
4. **Copy only the active branch.** `rebuild` walks the branch, not
   `document.entries`: carrying abandoned branches into a rewritten tree would
   resurrect turns the reader deleted.
5. **Re-parent the seam.** After removing a range, the first surviving entry's
   `parentId` is rewritten to the removed range's parent. A dangling parent makes
   the remaining turns invisible to pi.
6. **Operations are pure plans.** `planDeletePrompt` / `planTruncateFromPrompt`
   return data; the caller decides to write. They are unit-tested directly against
   fixture JSONL with no filesystem.

## Operation semantics

| Operation | Range removed |
|-----------|---------------|
| Delete one prompt | The prompt, plus everything up to (not including) the next user prompt — its reply, tool calls and tool results |
| Edit / regenerate | The prompt and **everything after it** |

Edit and regenerate truncate the tail because the replies that followed answered
the old text; keeping them would make the transcript contradict itself. The
provider then replays the prompt through pi, so pi owns the message shape, model
choice and usage accounting rather than this module hand-writing a user entry.

## Host orchestration (`src/provider/piViewProvider.ts`)

```
enqueueSessionMutation({ requireIdle: true })
  ├─ resolvePromptEntryId(ordinal, text)   ← get_fork_messages + text check
  ├─ get_state.sessionFile                 ← refuse when the session is not on disk
  ├─ loadSessionDocument / plan*           ← validate, then plan
  ├─ writeSessionDocument                  ← new sibling file
  ├─ activateSessionFile                   ← switch_session + waitForSessionReplacement
  └─ prompt (edit / regenerate only)
```

- The ordinal→entry mapping is **verified by text** and fails closed: the
  transcript is a window onto the session, and a stale ordinal must never take
  out a neighbouring turn.
- `activateSessionFile` deliberately does not reuse `switchSession()`: that method
  takes the mutation queue itself and would deadlock inside a caller that already
  holds it.
- A running turn is refused before anything is written (`requireIdle`), because
  the reply being streamed would otherwise be written into a file nobody reads.

## Anti-patterns

| Anti-pattern | Why |
|--------------|-----|
| Writing into the session pi has open | pi keeps its own in-memory tree; the file would desync or be overwritten |
| Deleting the original after a rewrite | Destroys the undo and the audit trail |
| Carrying abandoned branches forward | Resurrects turns the reader deleted |
| Trusting an ordinal without checking the text | A windowed transcript shifts ordinals |
| Hand-writing the user entry during edit | Bypasses pi's message shape and usage accounting |
| Parsing the session file anywhere else | The format then has two interpretations that will drift |

## Verification

```powershell
node --test test/unit/host/session-history.test.mjs
npm run typecheck
```

The unit suite covers round-tripping, the delete range, the truncation range, the
re-parented seam, identity/lineage, and every fail-closed path (version, empty
file, bad JSON, duplicate ids, non-prompt and off-branch targets).
