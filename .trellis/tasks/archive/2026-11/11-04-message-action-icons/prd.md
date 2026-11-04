# History Row Actions: lucide Icons and Chinese Labels

## Goal

The four row actions added by `2da5276` (`edit`, `delete`, `regenerate`, `fork`) and the
dialog they open still wear ad-hoc English words. Restyle them to match PI-Desktop
(`D:\code\PI-Desktop`), the reference implementation this repo ports features from:

- a row action is a 13px lucide icon button with a tooltip, never a word;
- the wording is PI-Desktop's zh-CN copy.

## Mapping

PI-Desktop sources: `apps/desktop/src/features/chat/transcript/{MessageRow,AssistantTurn}.tsx`
(`TooltipButton` + `IconPencil` / `IconTrash` / `IconReview` / `IconBranch`), icons from
`apps/desktop/src/components/icons.tsx` (lucide, `size 13`, `strokeWidth 1.75`), copy from
`packages/i18n/src/locales/zh-CN/index.ts` (`chat.*`).

| Row action | PI-Desktop icon | zh-CN label | current label |
| --- | --- | --- | --- |
| edit (user row) | lucide `PencilLine` | 编辑并重新发送 | `edit` |
| delete (user row) | lucide `Trash2` | 删除消息 | `delete` |
| regenerate (reply row) | lucide `RefreshCw` | 重新生成 | `regenerate` |
| fork (reply row) | lucide `GitFork` | 从此回复创建分支 | `fork` |

| Dialog slot | current | new |
| --- | --- | --- |
| edit title | `Edit message` | 编辑并重新发送 |
| edit confirm | `Save and re-run` | 重试 |
| delete title | `Delete this message?` | 删除消息 |
| delete confirm | `Delete` | 删除 |
| dialog cancel | `Cancel` | 取消 |

Delete keeps PI-Desktop's `danger` treatment on the icon button.

## Files

- `webview/transcript/renderer.ts` — `messageActionsHtml` renders the SVG + label.
- `webview/styles/transcript.css` — `.message-action` becomes an icon button; `.danger`.
- `webview/ui/modalController.ts` — `TextPromptOptions.cancelLabel` (optional, so the
  rename prompt keeps its English dialog).
- `webview/main.ts` — the two message dialogs pass the Chinese title/confirm/cancel.
- `test/unit/webview/transcript.test.mjs` — assert the icon markup and the labels.

## Rules

- Keep `data-message-action` / `data-prompt-ordinal`: the host addresses a prompt by the
  ordinal, and the click handler refuses while pi is busy — the buttons stay rendered
  either way, so no re-render is needed when streaming starts.
- The icons are inline SVG (the webview has no icon set of its own); `aria-hidden` on the
  glyph, `title` + `aria-label` on the button carry the Chinese label.
- Only these new controls are localized. The rest of the sidebar stays English until it
  gets a real i18n layer.

## Acceptance Criteria

- [x] Each row action is an icon button: no visible text, `title` and `aria-label` in
      Chinese, 13px glyph, `stroke-width 1.75`.
- [x] Delete uses the danger colour on hover, like PI-Desktop's `copy-btn icon danger`.
- [x] Edit and delete dialogs read 编辑并重新发送 / 重试 and 删除消息 / 删除, with 取消 as
      the cancel button.
- [x] The rename-session dialog is unchanged (still English `Cancel`/`Rename`).
- [x] `npm run verify` passes.

## Outcome

Shipped as one arc: the row actions, then the defects that surfaced while using them.

- Row actions are lucide icon buttons (PencilLine / Trash2 / RefreshCw / GitFork), appended
  after sanitizing, labelled with PI-Desktop's zh-CN copy, sitting under the bubble — the
  reader's own row right-aligned, a reply's row on its left edge — and only a message that
  actually carries an answer gets them.
- Reasoning shows while a reply streams and folds once it settles; a reader's toggle
  outranks the stream and survives the settle.
- A message's reasoning and tool calls fold into one process line (sparkles glyph, the run's
  shape, 含思考 when both appear, caret) that is open while streaming and closed afterwards.
  A closed bash box names the step (运行命令) instead of quoting the pipeline.
- Fixed while testing: `switch_session` sent its path under `path` where pi reads
  `sessionPath`, so every delete/edit/regenerate failed; `rebuild` re-pointed the surviving
  prefix at the gap's parent, turning the branch into a cycle pi refuses to load; a plan
  with no user turn now starts a fresh session instead of writing an unopenable file;
  startup restore skips sessions pi cannot open.

## Follow-ups left out

- Activity grouping is per message, not per run of consecutive activity; PI-Desktop also
  folds runs inside a message into nesting groups.
- The process line carries no elapsed time (PI-Desktop shows 处理中 · 12s / 已处理 12s).
- `promptOrdinal + text` is still a repeated pair across four protocol variants.
