# Webview Specs

> Conventions for `webview/` — the browser half: plain TypeScript + DOM + CSS, no
> framework, bundled by esbuild as an IIFE.

---

## Files

| File | Answers |
|------|---------|
| [state-and-rendering.md](./state-and-rendering.md) | State ownership, the render pipeline, and how to avoid redundant DOM work |
| [dom-and-styles.md](./dom-and-styles.md) | How DOM is built and sanitized, event listener placement, CSS and theming rules |
| [streaming-and-scroll.md](./streaming-and-scroll.md) | The transcript/streaming/scroll invariants that must not be "simplified" |

---

## Directory map

```
webview/
├── main.ts                 entry: element table, listeners, render pipeline, post()
├── main.css                9 @imports, cascade order matters
├── hostMessageHandler.ts   HostToWebviewMessage dispatch (assertNever tail)
├── rpcEventReducer.ts      pi events → UI state, schedules the smallest update
├── sanitizerPolicy.ts      the single DOMPurify policy
├── app/state.ts            UiState shape (no logic)
├── composer/               model (pure), controller, renderer, mentions, highlights
├── transcript/             controller, view, dom, renderer, streaming, scroll, media
├── session/                session controller + panels
├── ui/                     frame coordinator, header/runtime renderers, popups, modals
├── attachments/            image paste
└── styles/                 one file per region
```

## Architecture: model / renderer / controller

Each region splits into three roles, and the split is stated in the file's doc
comment. Keep the role of the file you edit:

| Role | Owns | Touches DOM? | Examples |
|------|------|--------------|----------|
| model | pure functions over data, no DOM, no state | no | `composer/model.ts`, `transcript/thinkingGroups.ts`, `transcript/transcriptOrder.ts`, `transcript/messageTime.ts` |
| controller | mutable state, invariants, lifecycle decisions | rarely; receives containers/callbacks | `transcript/controller.ts`, `composer/controller.ts`, `session/controller.ts`, `ui/selectController.ts` |
| renderer | DOM construction and updates only | yes | `transcript/dom.ts`, `composer/renderer.ts`, `ui/headerRenderer.ts`, `session/panels.ts` |

Dependency direction is one-way: `main.ts` → feature directories → `shared/`.

- Leaf modules never import `main.ts`. `transcript/dom.ts` gets the controller
  lazily through an accessor to avoid a cycle.
- Renderers receive narrow structural interfaces, not the element table:
  `ComposerElements`, `HeaderElements`, `SessionElements`. `main.ts` owns the ids.
- Collaborators are taken as `Pick<Collaborator, "methodA" | "methodB">`, not as
  whole objects.
- Test seams are injected (`requestFrame`, `cancelFrame`, `document?`,
  `shouldAnimate?`, `now()`), which is why DOM-heavy classes are testable in Node
  without jsdom.

## Naming conventions

| Kind | Convention | Examples |
|------|------------|----------|
| Files | `camelCase.ts`, directory is the role | `progressiveWindow.ts`, `hostMessageHandler.ts` |
| Classes | `PascalCase`, no `I` prefix | `TranscriptController`, `RpcEventReducer`, `ScrollAnchor`, `FrameCoordinator` |
| Renderers | factory functions returning renderers | `createTranscriptDom`, `createComposerRenderer`, `createHeaderRenderer`, `createSessionPanels` |
| Options | `interface XxxOptions` with callbacks as fields | `new ProgressiveWindow({ threshold: 60, initial: 40, chunk: 40 })` |
| Verbs | `apply*` authoritative input, `note*` record an observation, `sync*` reconcile a DOM affordance, `schedule*` enqueue frame work, `render*` write DOM, `toggle*/open*/close*/dismiss*` affordance lifecycle, `is*/has*/needs*` booleans | `applySnapshot`, `noteScroll`, `syncJumpButton`, `scheduleMeasure` |
| Types | `readonly` fields and injected collections; `private readonly options` | `readonly signature: string` |
| Tests | `test/unit/webview/<kebab>.test.mjs` mirrors the module | `webview/transcript/scrollAnchor.ts` → `scroll-anchor.test.mjs` |

Imports always carry `.js` (NodeNext).

## Indentation reality

`.prettierrc` says tabs, and most files use them, but about a dozen files use
**one-space** indentation (`app/state.ts`, `transcript/controller.ts`,
`transcript/dom.ts`, `transcript/viewport.ts`, `session/*.ts`,
`ui/headerRenderer.ts`, `composer/renderer.ts`, ...). Match the file you edit.
Never reformat a file as a side effect of a feature change — it buries the diff
and there is no formatter gate to hold you to it.

## Comments are design records

The long JSDoc blocks in `webview/` explain *why* and name the failure that forced
the code (`transcriptView.ts`, `scrollAnchor.ts`, `streaming.ts`,
`progressiveWindow.ts`). New non-obvious logic gets the same treatment, and the
comment is kept in sync with the behavior.
