# Webview layer conventions (`webview/`)

Browser half of the extension. **No framework** — plain TypeScript + DOM APIs + CSS, bundled by
esbuild, typed under the root `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`, NodeNext).
Entry point: `webview/main.ts` (2017 lines). `webview/main.css` is only `@import`s.

## 1. Architecture: model / renderer / controller

The split is stated in doc comments; each region has one owner per role.

| Role | Owns | Touches DOM? | Examples |
| --- | --- | --- | --- |
| **model** | pure functions over data — no DOM, no state | no | `composer/model.ts`, `transcript/thinkingGroups.ts`, `transcript/transcriptOrder.ts`, `transcript/messageTime.ts` |
| **controller** | mutable state, invariants, lifecycle decisions | rarely; gets containers/callbacks | `transcript/controller.ts:42`, `composer/controller.ts`, `session/controller.ts:18`, `ui/selectController.ts:19` |
| **renderer** | DOM construction/updates only | yes | `transcript/dom.ts:20`, `composer/renderer.ts:38`, `ui/headerRenderer.ts`, `session/panels.ts` |

```ts
// app/state.ts:4                   Shared view model; session transitions belong to SessionController, RPC deltas to RpcEventReducer.
// transcript/controller.ts:42      Owns transcript identity, playback, disclosure and reconciliation across sessions.
// transcript/dom.ts:20             Materializes transcript nodes; state and reconciliation stay in TranscriptController.
// composer/renderer.ts:38          Owns composer render caches; editing and reference identity remain in ComposerController.
// ui/frameCoordinator.ts:17        Runs transcript measurement, rendering, and scrolling in one native frame.
```

**Dependency direction is one-way: entry → feature dirs → `shared/`.**

- `shared/*` never imports `webview/` or `src/`; it is the platform-neutral boundary
  (`protocol.ts`, `jsonValues.ts`, `messageContent.ts`, `composerReferences.ts`).
- Leaf modules never import `main.ts`. `dom.ts` gets the controller lazily —
  `controller(): TranscriptController` (`transcript/dom.ts:10`) — to avoid the cycle, since
  `main.ts` imports `dom.ts`.
- Renderers never import the element table; `main.ts` owns it (`main.ts:109-169`) and passes narrow
  structural interfaces: `ComposerElements` (`composer/renderer.ts:6`), `HeaderElements`
  (`ui/headerRenderer.ts:4`), `SessionElements` (`session/panels.ts:6`).
- Components take `Pick<>` of collaborators, not whole objects:
  ```ts
  // session/controller.ts:8
  transcript: Pick<TranscriptController, "adoptSnapshot" | "reconcileSnapshot" | "interrupt">;
  // transcript/viewport.ts:9
  frames: Pick<FrameCoordinator, "requestScrollFrame" | "cancelScrollFrame" | "scheduleMeasure">;
  ```
- Test seams are injected (`requestFrame`, `cancelFrame`, `document?`, `shouldAnimate?`, `now()`),
  so DOM-heavy classes are testable in `test/unit/webview/` without jsdom.

**State ownership:** `app/state.ts` declares the shape (`UiState`); `main.ts:83` owns the only
instance (`const ui = createUiState()`). Only two writers exist: `SessionController` (authoritative
snapshots) and `RpcEventReducer` (`rpcEventReducer.ts:47`, "Reduces pi RPC events into Webview state
and schedules the smallest UI update"). `HostMessageHandler` (`hostMessageHandler.ts:22`) dispatches
`HostToWebviewMessage` into callbacks "without knowing the Webview's state model" — new host
messages go there + `shared/protocol.ts` only.

## 2. State management without a framework

No store, no subscribe. **Imperative mutation + one coalescing render scheduler + per-region
signature caches.**

- State is a plain mutable object (`options.ui.busy = true`, `state.messages = messages`) and
  renderers read that same object at render time (`createHeaderRenderer({ elements, state: ui })`).
- Re-render is requested explicitly, never observed: components take `scheduleRender()`
  (`TranscriptControllerOptions.scheduleRender`, `ComposerControllerOptions.invalidate`,
  `SessionControllerOptions.scheduleRender`) → `frameCoordinator.scheduleRender()` → one rAF.
- `render()` (`main.ts:1129`) is a fixed ordered pipeline of per-region calls:
  `headerRenderer.render()` → `transcriptController.render()` → `restoreThinkingAnchor` → composer
  renderers → `finishRender()` → `refreshRelativeTimes()` → **`scrollAnchor.stickToBottomIfFollowing()`**
  → `syncJumpToBottomButton()` → `scheduleTranscriptMeasure()`. Ends with the comment
  `// Pin only after all regions finish writing DOM and refreshing time labels.`
- **Idempotence by signature** is the core idiom — module-scope `let lastSignature` + early return:
  ```ts
  // composer/renderer.ts:47
  const signature = ui.attachments.map((i) => `${i.id}:${i.kind}:${i.label}:${i.path}`).join("\u0000");
  if (signature === attachmentSignature) return;
  ```
  Same in `renderComposerHighlights()` (`:80`), `reflowComposerTools()` (`:154`), and structurally in
  the transcript (`TranscriptEntry.signature`, `transcript/transcriptView.ts:23-35`). Signatures are
  `\u0000`-joined strings, never `JSON.stringify`.
- `FrameCoordinator` coalesces `measure`/`advance`/`transcriptRender`/`render` plus a scroll task
  into one frame and captures flags first: `// Capture before running any phase. Work requested by a
  later phase belongs to the next browser frame rather than running after its own DOM writes.`
- Persisted state is minimal and validated: `vscode.setState({ draft, composerReferences })`
  (`main.ts:238`), parsed by `parsePersistedReferences` (`composer/model.ts`).

## 3. DOM construction conventions

Three tiers; do not mix inside one region.

1. **Static chrome is host HTML**, not webview-built: `src/webviewDocument.ts:37-130` emits every id
   (`#app`, `#transcript`, `#messages`, `#composer`, `#prompt-input`, `#select-popup`,
   `#modal-backdrop`, …). `main.ts` resolves them once — `element<T>(id)` (`main.ts:2013`) throws
   `Missing #id` if markup drifts.
2. **Message/markdown content is produced as HTML strings** (`transcript/renderer.ts`:
   `messageHtml`, `assistantMessageSections`, `toolBodyHtml` return `string`) and parsed through the
   single sanitizing path:
   ```ts
   // main.ts:2005
   function sanitizedNodes(html: string): Node[] {
     const sanitized = DOMPurify.sanitize(html, TRANSCRIPT_SANITIZE_OPTIONS);
     const parsed = new DOMParser().parseFromString(sanitized, "text/html");
     return [...parsed.body.childNodes].map((n) => document.importNode(n, true));
   }
   ```
   **Never assign `innerHTML`.** One policy for the whole webview: `TRANSCRIPT_SANITIZE_OPTIONS`
   (`sanitizerPolicy.ts:4`) — forbids `<style>` and `style=` because CSP keeps `'unsafe-inline'`
   for mermaid's SVG.
3. **Everything else is `createElement` + `textContent` + `append`** — `createMessageNode`
   (`transcript/dom.ts:129`), `enhanceCodeBlocks` (`:211`), `renderAttachments`
   (`composer/renderer.ts:46`), `createCodicon` (`main.ts:1998`). No `insertAdjacentHTML`.

Helpers live in `transcript/dom.ts` (`createMessageNode`, `patchStreamingMessage`,
`toggleExpandable`, `refreshExpandedToolBody`, `linkifyWorkspacePaths`,
`applyMessageBoundaryClasses`); no generic util module — single-purpose helpers sit next to their
user (`ui/popupPosition.ts`, `ui/liveStatus.ts`).

**Listeners:**
- Static elements: attached once at module scope in `main.ts` (`:361-880`), never removed. 47
  `addEventListener` calls there; no `removeEventListener` for these.
- Dynamic content: **delegated on a stable ancestor**. `elements.messages` has exactly two
  listeners (`click` `:796`, `keydown` `:873`) dispatched via `target.closest(...)`:
  ```ts
  const copyButton = target.closest<HTMLButtonElement>("[data-copy-code]");
  const expandable = target.closest<HTMLElement>("[data-expandable]");
  ```
- Per-node listeners only for non-delegatable events: `<img>` `load` (`main.ts:1214`, guarded by
  `image.dataset.scrollBound = "true"`), or constructor binding where there is no ancestor
  (`SelectController`, `ModalController`).
- Elements identified later carry `data-*` read through `dataset`: `data-tool-key`,
  `data-tool-body="lazy"`, `data-thinking-key`, `data-section-key`, `data-section-hash`,
  `data-workspace-path`, `data-expandable`.

**Accessibility:** icon-only buttons set both `title` and `aria-label`; codicons are
`aria-hidden="true"`; expandables are plain elements with `role="button"` + `aria-expanded` and
hand-wired Enter/Space (`main.ts:873`); status sentences go through `LiveStatusAnnouncer`
(`ui/liveStatus.ts:7`); `:focus-visible` styling lives in `styles/base.css:173-183`.

## 4. CSS organization

`webview/main.css` is 9 `@import`s in cascade order:

```css
pi-theme.css   /* pi palette tokens, light/dark blocks (pi's own token names) */
base.css       /* :root + body tokens, resets, header, icon-button */
transcript.css /* messages, tools, thinking, diffs, empty state (1624 lines) */
mermaid.css  sessions.css  commands.css  composer.css
overlays.css   /* popups, modal, toast, drop overlay */
responsive.css /* @media (prefers-reduced-motion), max-width: 320px */
```

New styles go in the region file; a new region file is added only with justification, and its
`@import` goes before `responsive.css`.

**Naming:** lowercase kebab-case classes, block-ish but **not BEM** — no `__` or `--` in any class
name. `.message-slot`, `.assistant-text`, `.activity-timeline`, `.tool-call`, `.code-block`,
`.copy-code-button`, `.pinned-prompt-text`, `.attachment-chip`, `.fork-row`.

- **State modifiers are `is-*`**, always toggled from TS: `is-working` (`headerRenderer.ts:38`),
  `is-active`, `is-expanded`, `is-overflowing` (`overlayScrollbar.ts:118`), `is-visible`
  (`viewport.ts:40`), `is-thinking`, `is-icons`, `is-minimal`, `is-dragging`, `is-overlay-scrolled`.
  Legacy exceptions: `.expanded` (tools), `.busy` (composer), and the structural boundary classes
  `.user-turn` / `.assistant-starts-text` / `.assistant-ends-thinking` on `.message-slot`.
- IDs are reserved for the static shell (`#app`, `#messages`, `#transcript`).

**Theming:** two layers. `styles/pi-theme.css` holds `--pi-theme-*` = pi's own token names (ported
from pi's `dark.json`/`light.json`; the header documents every deliberate departure, and light/dark
are keyed off `body.vscode-light` / `body.vscode-dark`). `styles/base.css` derives semantic
`--pi-*` (`--pi-accent`, `--pi-border`, `--pi-muted`, `--pi-surface`, `--pi-line`,
`--pi-font-code`, `--pi-radius-control`) — **component CSS consumes `--pi-*`, not `--pi-theme-*`
or raw hex.**

VS Code variables appear **only as fallbacks**:

```css
/* base.css:2-4 */
--pi-border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.32)));
--pi-muted: var(--vscode-descriptionForeground, #9ba1a6);
--pi-page-background: var(--vscode-sideBar-background, var(--vscode-editor-background));
```

Sizes derive from `--vscode-font-size` (`--pi-line: calc(var(--vscode-font-size, 13px) * 1.5)`), not
`--vscode-editor-font-size`. Surfaces use `color-mix(in srgb, var(--pi-…) N%, transparent)`.
Theming is tested: `test/unit/webview/pi-theme.test.mjs`.

## 5. Host ⇄ webview boundary

- Types: `shared/protocol.ts` — `HostToWebviewMessage` (`:207`), `WebviewToHostMessage` (`:299`),
  `MAX_*` bounds, `WEBVIEW_REQUEST_TYPES`.
- Inbound is exactly one listener, registered **last** in `main.ts:1120`:
  `// Install the listener only after all message dependencies have been initialized.` → forwards to
  `HostMessageHandler`; then `post({ type: "ready" })` (`:1123`).
- Outbound is one wrapper, and only that wrapper is used — `// main.ts:1886
  function post(message: WebviewToHostMessage): void { vscode.postMessage(message); }`
  Components receive `post` as an option (`ComposerRendererOptions.post`,
  `SessionPanelsOptions.requestSessions`); they never call `acquireVsCodeApi`.
- Correlation by explicit ids the caller makes: `crypto.randomUUID()` for actions (`main.ts:1867`),
  `requestId` for listings/media/mentions. Unanswered actions live in
  `pendingActions: Map<string, PendingAction>`.
- RPC events arrive wrapped (`{ type: "rpcEvent", event }`) and are typed `JsonRecord`; field access
  goes through `shared/jsonValues.ts` (`stringValue`, `numberValue`, `objectValue`) instead of
  casts (`rpcEventReducer.ts`, `transcript/streaming.ts`). Everything inbound is untrusted input
  (CONTRIBUTING.md).
- Exhaustiveness via `assertNever(message)` (`hostMessageHandler.ts:74`). Unknown *pi* event types
  fall through on purpose: `// Unknown public events remain forward-compatible and keep the old
  render fallback.`

## 6. Streaming / scroll invariants (hard-won — do not "simplify")

**a) One keyed DOM node per message; rebuild only on signature change.** `transcriptView.ts:2-20`:
> The transcript used to be rebuilt wholesale on every render: each message was re-parsed from
> markdown, re-sanitized, and every node in the scroll container was replaced […] A streaming reply
> therefore touches exactly one node per frame and leaves history — the part the reader is scrolled
> into — physically untouched.

Key rule (`transcript/transcriptView.ts:23-35`): a slot key "must not change while the message stays in the
transcript […]; changing a key needlessly rebuilds the node and drops its expanded/selection
state." Returning `previous` from `createNode` means in-place patch — the view must not re-insert
it, which "would detach it from the DOM" (`transcriptView.ts:152-185`).

**b) Identity is inherited across mutated message objects.** `WeakMap<PiMessage, MessageIdentity>`
with `key` + `version`; `inherit()` bumps version when a new object replaces the streaming one
(`controller.ts:79-87`). Snapshots adopt identity *before* swapping arrays:
`// Identity must be adopted against the old array, before installing the snapshot.`
(`session/controller.ts:28`).

**c) Streaming text appends, it does not re-render.** `patchStreamingMessage` (`dom.ts:26`) compares
`data-section-key` + `data-section-hash` per section, then `appendStreamingText` appends the suffix
to the last text node / code tail; full re-parse is the fallback — "Streaming hashes sample edges;
equal-length corrections still need a full text comparison" (`dom.ts:40`).

**d) Playback decouples network cadence from paint cadence.** `streaming.ts:121`: "The target
message always receives deltas immediately. The displayed message approaches that target over
several animation frames, so bursty providers do not turn into bursty paints. This class knows
nothing about scroll position: reading older content can stop viewport following without pausing
playback." `finish()`: `// Keeps the authoritative message hidden until its buffered text is
visible.`

**e) Follow-bottom is intent-based, not distance-based.** `scrollAnchor.ts:1-16`: "Streaming
appends content every frame, so 'scroll to bottom on new content' has to be conditional or it fights
the reader […] A distance-from-bottom threshold alone cannot express the difference, because the
reader starts every gesture from the bottom […] So intent is tracked explicitly."
Preserve: `bottomThresholdPx` stays small (4px); "did we cause this scroll?" is decided by
`expectedScrollTop` ± `PROGRAMMATIC_TOLERANCE_PX` (1px); one unexpected scroll during an animation
is absorbed, a second hands the viewport to the reader (`scrollAnchor.ts:200-215`);
`stickToBottomIfFollowing` reads back the applied offset "so a clamped value still counts as ours".

**f) Pin only after all regions write DOM**, and measure lazily: `// Measured only once following is
confirmed: reading the scroll metrics forces a layout, and a render pass where the reader has
scrolled away does not owe it one.` (`scrollAnchor.ts:299`).

**g) Big first builds are staged tail-first.** `progressiveWindow.ts:1-12`, wired as
`new ProgressiveWindow({ threshold: 60, initial: 40, chunk: 40 })`: "The tail is what the reader
actually lands on, so that is what the first pass renders; the rest backfills a window-worth at a
time […] The window is always a suffix: backfill inserts above the fold, so a reader sitting at the
bottom never sees the transcript move under them." Plus a hard render cap (`limit = 150`) with a
`history-omitted` banner and host-supplied `omittedMessageCount`.

**h) Local reflows compensate scroll instead of detaching.** Disclosure toggles call
`anchor.detach()`, then `restoreThinkingAnchor(offset => anchor.adjustBy(offset))`, measuring the
same element before/after (`controller.ts:setThinkingVisibility`, `scrollAnchor.adjustBy`).
`adjustBy` records the assignment as programmatic so its scroll event is not read as reader input.

## 7. Naming conventions actually used

- **Files** camelCase `.ts`; directories are roles (`app/`, `composer/`, `transcript/`, `session/`,
  `ui/`, `attachments/`). Imports always carry `.js` (NodeNext).
- **Classes** `PascalCase`, no `I` prefix — controllers/engines are classes (`TranscriptController`,
  `ComposerController`, `SessionController`, `RpcEventReducer`, `HostMessageHandler`, `ScrollAnchor`,
  `TranscriptView`, `ProgressiveWindow`, `FrameCoordinator`, `ModalController`, `SelectController`,
  `LiveStatusAnnouncer`, `MediaSources`).
- **Renderers are factory functions**, not classes (`createTranscriptDom`, `createComposerRenderer`,
  `createHeaderRenderer`, `createRuntimeRenderer`, `createSessionPanels`, `createTranscriptViewport`),
  returning renderers or a destructured object (`return { createMessageNode, … }`).
- **Options objects**: `interface XxxOptions` with callbacks as fields, consumed as
  `constructor(private readonly options: XxxOptions)` or `createXxx(options: XxxOptions)`.
- **Verb semantics** — match these: `apply*` authoritative input (`applySnapshot`, `applyDelta`);
  `note*` record an observation (`noteScroll`, `noteUserIntent`); `sync*` reconcile a DOM affordance
  (`syncJumpButton`); `schedule*` enqueue frame work (`scheduleRender`, `scheduleMeasure`,
  `scheduleAdvance`, `scheduleTranscriptRender`); `render*` write DOM; `toggle*/open*/close*/dismiss*`
  affordance lifecycle; `is*/has*/needs*` boolean getters (`isFollowing`, `needsFrame`). Private
  booleans are `isXxx` (`isInactive`, `isMeasurePending`).
- **Types**: `readonly` on interface fields and injected collections; `private readonly options`; no
  `as` casts on inbound JSON — use `jsonValues.ts`; `satisfies` where an annotation would widen
  (explained in `sanitizerPolicy.ts`).
- **Tests**: `test/unit/webview/<kebab>.test.mjs` mirroring the module, loaded via
  `loadBundledModule({ entry: "webview/…/x.ts" })` (esbuild → temp dir → dynamic `import`), per
  `test/helpers/load-bundled-module.mjs`: "browser-targeted modules still load in Node after
  bundling; tests provide any DOM globals they need". Pure functions/policy classes preferred; DOM
  renderers are covered by `region-renderers.test.mjs` with hand-rolled element fakes.
- **Indentation**: `.prettierrc` = `useTabs: true, tabWidth: 2`, and most files use tabs. **Reality:**
  11 files use 1-space indent (`app/state.ts`, `transcript/{controller,dom,viewport,workspacePaths}.ts`,
  `composer/renderer.ts`, `session/*.ts`, `ui/{headerRenderer,runtimeRenderer}.ts`,
  `sanitizerPolicy.ts`) — match the file you edit, never reformat a file as a side effect.
- **Comments are design records.** Long JSDoc explaining *why*, naming the failure mode that forced
  the code, is the house style across `webview/`; new non-obvious logic carries one and keeps it in
  sync with behaviour.

## Unverified

- Whether prettier is enforced anywhere: no `format`/`lint` npm script exists (`npm run verify` =
  typecheck + unit tests + `check-generated`), so no prettier gate was found.
- esbuild webview chunking/options in `scripts/build.mjs` (out of scope for this doc).
