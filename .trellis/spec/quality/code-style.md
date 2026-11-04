# Code Style

> There is no ESLint config and prettier is not installed. Formatting is a review
> convention, `tsc` is the only automatic check, and the strongest rule in the
> repository is "match the file you are editing".

---

## When this applies

Every change. When in doubt, open a neighboring file in the same directory and
copy its shape.

---

## 1. Formatting reality

- `.prettierrc` exists but contains only `{ "useTabs": true, "tabWidth": 2 }`;
  prettier is absent from `devDependencies` and there is no `format` script.
- Most source and test files indent with **tabs**. About two dozen files use
  **one-space** indentation (`shared/assertNever.ts`, `shared/messageContent.ts`,
  `webview/app/state.ts`, `webview/transcript/controller.ts`,
  `webview/session/*.ts`, `webview/ui/*.ts`, and several
  `test/unit/webview/*.test.mjs`).
- Therefore: **match the file you edit.** Never reformat a file as a side effect
  of an unrelated change — it buries the diff and CONTRIBUTING.md explicitly asks
  to avoid mixing functional changes with broad formatting.
- Quoting and punctuation in existing code: double quotes, semicolons, trailing
  commas in multiline literals.
- Files are CRLF. `.gitattributes` only configures `merge=union` for
  `.trellis/workspace/*/journal-*.md`; it does not normalize EOL.

## 2. Type-safety rules

`tsconfig.json` gives one program for `src/`, `webview/`, and `shared/`:

- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`,
  `target/module: ES2022/NodeNext`, `lib: ["ES2022", "DOM", "DOM.Iterable"]`.
- Not enabled (so do not rely on them): `noImplicitReturns`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUnusedLocals`.
- `NodeNext` means **every relative import ends in `.js`**, and type-only imports
  use `import type`.
- Because one program has DOM + node + vscode types, `tsc` cannot enforce layer
  isolation. That is why [architecture/layer-boundaries.md](../architecture/layer-boundaries.md)
  exists.

Rules:

| Rule | Why |
|------|-----|
| `unknown` at every boundary, never `any` | `any` appears nowhere in `src/`, `shared/`, `webview/` (only in prose comments) |
| Cast only after validation (`value as PiState` post-checks) | A cast before checks is a silent lie |
| Use `jsonValues.ts` helpers for untrusted JSON in the Webview | Beats inline `as` casts and survives unknown shapes |
| `interface` for object shapes, `type` for unions/aliases | Matches the codebase's distribution |
| `readonly` on interface fields and injected collections | Prevents accidental mutation of shared state |
| `as const satisfies …` when a literal must also be checked | `satisfies` keeps the narrow type and still validates (see `sanitizerPolicy.ts`); a plain annotation can widen or break overloads |
| `Pick<Collaborator, "a" \| "b">` for collaborators | Documents exactly what a unit needs |
| Open-ended enums as `T \| (string & {})` | Unknown future values degrade instead of failing validation |

## 3. Naming

- Files: `camelCase.ts`. Directories: lowercase, singular, role-named
  (`provider`, `services`, `rpc`, `transcript`, `composer`, `session`, `ui`).
- Test files: kebab-case mirroring the module (`asyncQueue.ts` →
  `async-queue.test.mjs`).
- Classes/types: `PascalCase`. Constants: `UPPER_SNAKE` at module scope, with the
  unit in the name (`MAX_RECORD_BYTES`, `DEFAULT_TIMEOUT_MS`,
  `PROGRAMMATIC_TOLERANCE_PX`).
- Function prefixes carry meaning: `parse*` / `validate*` (validation),
  `assert*` (throws), `is*` / `should*` / `needs*` (boolean), `create*`
  (factory), `apply*` (authoritative input), `note*` (observation), `sync*`
  (reconcile a DOM affordance), `schedule*` (enqueue frame work), `render*`
  (write DOM).

## 4. Comments are design records

The house style is a JSDoc block that explains **why**, naming the bug or
constraint that forced the code, and staying in sync with behavior. Examples
worth reading before writing a new one:

- [shared/assertNever.ts](../../../shared/assertNever.ts) — the variant that
  vanished at runtime.
- [webview/sanitizerPolicy.ts](../../../webview/sanitizerPolicy.ts) — why `style`
  is forbidden while the CSP keeps inline styles.
- [webview/transcript/scrollAnchor.ts](../../../webview/transcript/scrollAnchor.ts)
  — why intent beats distance.
- [src/services/sessionStore.ts](../../../src/services/sessionStore.ts) — why
  path runs must not be collapsed (Windows session history).

Do not add a comment that restates the next line. Add one when a reader would
otherwise "simplify" the code and reintroduce a bug.

## 5. Module shape

- One concern per file. A module that both decides and performs I/O should be
  split (that is how `deliveryPolicy`, `notificationPolicy`, `sessionMutation`,
  and `missedReplies` came to exist).
- Pure decision modules live next to their consumer and export standalone
  functions.
- Platform access is injected through an interface (`WindowsPiLaunchDeps`,
  `MediaPathResolver`, `requestFrame`, `document?`) so tests need no shims.
- No barrel files; import the concrete module.
- Do not introduce a shared utility for two callers that happen to look alike —
  see the reuse guide at [guides/code-reuse-thinking-guide.md](../guides/code-reuse-thinking-guide.md).

## 6. Review checklist

- [ ] Indentation matches the file; no unrelated reformatting in the diff.
- [ ] Relational imports end in `.js`; type-only imports use `import type`.
- [ ] No `any`, no pre-validation casts, `unknown` at boundaries.
- [ ] Names follow the prefix semantics above.
- [ ] New non-obvious logic carries a *why* comment.
- [ ] `npm run typecheck` clean; `npm run verify` green before opening the PR.
- [ ] `CHANGELOG.md` updated for user-visible behavior.
