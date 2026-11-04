# DOM and Styles

> The Webview builds DOM in three tiers, sanitizes HTML in exactly one place, and
> styles through two layers of CSS tokens. Mixing tiers is the usual source of
> XSS-shaped bugs and theme breakage.

---

## When this applies

Any change that creates elements, injects HTML, adds listeners, adds CSS, or
touches theming.

---

## 1. DOM construction: three tiers, do not mix

**Tier 1 — static chrome is host HTML.** `src/webviewDocument.ts` emits the whole
shell and every id (`#app`, `#transcript`, `#messages`, `#composer`,
`#prompt-input`, `#command-panel`, `#history-panel`, `#modal-backdrop`,
`#select-popup`, `#live-status`, ...). `main.ts` resolves them once through

```ts
function element<T extends HTMLElement>(id: string): T
```

which throws `` Missing #${id} `` ([main.ts:2013](../../../webview/main.ts)) when
markup drifts. Adding a static element means adding it to `webviewDocument.ts`,
not creating it in TS.

**Tier 2 — message and markdown content is produced as HTML strings**, then parsed
through the single sanitizing path:

```ts
// main.ts:2005
function sanitizedNodes(html: string): Node[] {
  const sanitized = DOMPurify.sanitize(html, TRANSCRIPT_SANITIZE_OPTIONS);
  const parsed = new DOMParser().parseFromString(sanitized, "text/html");
  return [...parsed.body.childNodes].map((n) => document.importNode(n, true));
}
```

**Never assign `innerHTML`.** Renderers in `transcript/renderer.ts` return strings;
only `sanitizedNodes` turns a string into nodes.

The policy lives in [sanitizerPolicy.ts](../../../webview/sanitizerPolicy.ts) and is
shared by both paths (renderer sanitization and re-parsing). It forbids `<style>`
and `style=` because the CSP must keep `'unsafe-inline'` for mermaid's SVG; the
doc comment explains the attack. `data-copy-code` is intentionally not allowed
through the sanitizer — the copy button is built with DOM APIs afterwards.

**Tier 3 — everything else is `createElement` + `textContent` + `append`.**
Examples: `createMessageNode`, `enhanceCodeBlocks`, `renderAttachments`,
`createCodicon`. No `insertAdjacentHTML`, no template strings for user data.

Helpers live next to their user (`transcript/dom.ts`, `ui/popupPosition.ts`,
`ui/liveStatus.ts`); there is no generic util module.

## 2. Listeners

- **Static elements:** attached once at module scope in `main.ts`, never removed.
- **Dynamic content:** delegated on a stable ancestor. `elements.messages` has
  exactly two listeners — `click` ([main.ts:796](../../../webview/main.ts)) and
  `keydown` ([main.ts:873](../../../webview/main.ts)) — dispatching through
  `target.closest("[data-...]")`.
- **Per-node listeners** only for events that cannot be delegated (`<img>` `load`,
  guarded by `image.dataset.scrollBound = "true"`) or where there is no ancestor
  (`SelectController`, `ModalController` constructor binding).
- Elements identified later carry `data-*` attributes read through `dataset`
  (`data-tool-key`, `data-tool-body`, `data-thinking-key`, `data-section-key`,
  `data-section-hash`, `data-workspace-path`, `data-expandable`).

## 3. Accessibility

- Icon-only buttons set **both** `title` and `aria-label`.
- Codicons are `aria-hidden="true"`.
- Expandables are plain elements with `role="button"` and `aria-expanded`, with
  hand-wired Enter/Space handling.
- Status sentences go through `LiveStatusAnnouncer`
  ([ui/liveStatus.ts](../../../webview/ui/liveStatus.ts)), which writes into the
  single `aria-live` region.
- Keyboard focus must remain reachable: `:focus-visible` styling lives in
  `styles/base.css`.

## 4. CSS organization

`webview/main.css` is nine `@import`s; the cascade order is meaningful:

```
pi-theme.css, base.css, transcript.css, mermaid.css, sessions.css,
commands.css, composer.css, overlays.css, responsive.css
```

- New styles go into the existing region file.
- A new region file needs justification, its `@import` must be placed **before**
  `responsive.css`, and — when it is a new component — its selector must be added
  to `requiredCssRules` in [scripts/check-generated.mjs](../../../scripts/check-generated.mjs)
  (one representative rule per component: `#app{`, `.transcript{`,
  `.mermaid-block{`, `.history-panel{`, `.command-panel{`, `.composer-shell{`,
  `.modal-backdrop{`, `@media(max-width:320px)`). That gate catches a dropped
  `@import` in the minified bundle.

## 5. Class naming and state modifiers

- Lowercase kebab-case class names, block-ish but **not BEM**: no `__`, no `--`
  in class names (`.message-slot`, `.assistant-text`, `.tool-call`,
  `.code-block`, `.attachment-chip`).
- State modifiers are `is-*`, toggled from TypeScript: `is-working`, `is-active`,
  `is-expanded`, `is-overflowing`, `is-visible`, `is-thinking`, `is-icons`,
  `is-minimal`, `is-dragging`, `is-overlay-scrolled`.
- Legacy exceptions exist and are grandfathered: `.expanded` (tools), `.busy`
  (composer), and the structural boundary classes `.user-turn` /
  `.assistant-starts-text` / `.assistant-ends-thinking`. Do not add new ones —
  use `is-*`.
- **Ids are reserved for the static shell.**

## 6. Theming: two layers

1. `styles/pi-theme.css` holds `--pi-theme-*` — pi's own token names, ported from
   pi's `dark.json` / `light.json`, keyed off `body.vscode-light` /
   `body.vscode-dark`. Deliberate departures are documented in the file header.
2. `styles/base.css` derives semantic tokens: `--pi-accent`, `--pi-border`,
   `--pi-muted`, `--pi-surface`, `--pi-line`, `--pi-font-code`, `--pi-radius-control`.

**Component CSS consumes `--pi-*` only.** Raw hex, `--pi-theme-*`, and VS Code
variables are not allowed in a component file.

VS Code variables appear **only as fallbacks** inside the semantic token
definitions:

```css
--pi-border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.32)));
```

Sizes derive from `--vscode-font-size` (not `--vscode-editor-font-size`); surfaces
use `color-mix(in srgb, var(--pi-…) N%, transparent)`.

Theming is tested: [test/unit/webview/pi-theme.test.mjs](../../../test/unit/webview/pi-theme.test.mjs).

## 7. Anti-patterns

| Anti-pattern | Why |
|--------------|-----|
| `element.innerHTML = ...` or `insertAdjacentHTML` | Bypasses `TRANSCRIPT_SANITIZE_OPTIONS`; the CSP does not save you from DOM XSS |
| Building a second DOMPurify config | Safety would depend on which path a fragment took |
| Allowing `style` / `style=` through the sanitizer | Any transcript text could repaint the whole sidebar |
| Creating a static shell element from TS | `element()` throws and the drift is silent until runtime |
| A new `addEventListener` on `elements.messages` | Escapes delegation; use `closest("[data-...]")` |
| New `__`/`--` class names, or a new non-`is-*` state class | Inconsistent with the existing naming; breaks `is-*` toggling expectations |
| Raw hex or `--vscode-*` in a component CSS file | Breaks theme switching and pi palette parity |
| A new CSS file without updating `check-generated.mjs` | The reproducible-build gate silently stops covering it |
