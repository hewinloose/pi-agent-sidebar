# Protocol and Validation

> `shared/protocol.ts` is the only contract between the extension host and the
> Webview, and every inbound payload is untrusted. This file describes the shape
> of that contract and the three validation modes the repository actually uses.

---

## When this applies

- Adding/removing a field or a variant on `HostToWebviewMessage` / `WebviewToHostMessage`.
- Parsing anything that arrives from the Webview, from pi, or from persisted state.
- Wondering whether to throw, return `undefined`, or silently degrade.

---

## 1. The protocol is a discriminated union

- `HostToWebviewMessage` and `WebviewToHostMessage` are unions of object literals
  keyed on `type` ([shared/protocol.ts](../../../shared/protocol.ts)).
- Sub-payloads inside a message use their own `kind` discriminator
  (`WorkspaceEntrySuggestion`, `ComposerReference`).
- Protocol interfaces extend `JsonRecord` (`Record<string, unknown>`) so pi's
  extra fields survive a round trip while access stays typed. Omit the index
  signature deliberately where it would widen `keyof` — see the `PiCapabilities`
  comment.
- Open-ended enums use `(string & {})` so an unknown future value degrades
  instead of failing validation.

Do **not** invent a parallel ad-hoc message type in `src/` or `webview/`. If the
half-to-half contract changes, it changes in `shared/protocol.ts`.

## 2. Three validation modes — pick the right one

No schema library is used anywhere (no zod/ajv). Every boundary has a
hand-written, bounded parser, and the failure mode is chosen per boundary:

| Boundary | Entry point | On invalid input | Why |
|----------|-------------|------------------|-----|
| Webview → host | `parseWebviewMessage(value: unknown): WebviewToHostMessage \| undefined` ([protocolParser.ts:17](../../../shared/protocolParser.ts)) | returns `undefined`, never throws | A malicious or stale page must not crash the provider; the caller logs `"[webview] Ignored an invalid message."` |
| pi → host | `parsePiState` and the other `parse*` ([rpcValidation.ts](../../../src/rpc/rpcValidation.ts)) | throws `ProtocolValidationError` with a dotted path (`state.sessionName`) | A protocol mismatch is a real bug; the transport surfaces it and the provider decides |
| pi events inside the Webview | `objectValue` / `stringValue` / `numberValue` ([jsonValues.ts](../../../shared/jsonValues.ts)) | returns a benign empty value | Rendering must survive unknown event shapes and stay forward-compatible |

Rules that hold across all three:

- Input is typed `unknown` at the boundary. `any` appears nowhere in `src/`,
  `webview/`, or `shared/` — do not introduce it.
- Bound everything numeric or stringy. Caps are `UPPER_SNAKE` module constants
  named `MAX_*`; caps both halves must agree on are exported from
  `shared/protocol.ts` (for example `MAX_PATH_LENGTH`, `MAX_ATTACHMENT_COUNT`,
  `MAX_IMAGE_BYTES`).
- Rebuild, do not spread. `parseWebviewMessage` returns a freshly constructed
  object, so an unexpected field a page sends is *dropped*, not forwarded.
- Cast only after validation (`return state as PiState`).
- Interpret leniency explicitly and comment it: `parseCommandsResponse` drops bad
  rows rather than failing the list; `parseMessagesWindow` deliberately does not
  validate a dropped tail.

## 3. Exhaustiveness is a compile-time gate

Two independent mechanisms; use whichever matches what you are extending.

**(a) `switch` over a protocol union** must end with
`default: assertNever(message)`
([shared/assertNever.ts](../../../shared/assertNever.ts)). Call sites:
[webviewMessageRouter.ts:134](../../../src/provider/webviewMessageRouter.ts) and
[hostMessageHandler.ts:74](../../../webview/hostMessageHandler.ts).
`assertNever` exists because a missing variant once compiled cleanly with a bare
`break` and the message vanished at runtime.

**(b) A runtime list of request types** must stay in sync via
`WEBVIEW_REQUEST_TYPES` ([protocol.ts:378](../../../shared/protocol.ts)). The
list is `as const satisfies readonly WebviewToHostMessage["type"][]`, and
`UnlistedRequestType` is passed to `assertEveryRequestTypeIsListed`
([protocol.ts:430](../../../shared/protocol.ts)); a missing entry fails `tsc`.
`test/unit/shared/protocol.test.mjs` walks the same list and proves the parser
accepts one valid message per variant.

## 4. Adding a protocol variant — the coordinated edit

Never touch only one file. A complete change is:

1. Union member in `shared/protocol.ts` (and any `MAX_*` bound it needs).
2. Parser branch in `shared/protocolParser.ts` (or the pi-side `parse*` in
   `src/rpc/rpcValidation.ts`).
3. If Webview → host and the type is browser-initiated, add it to
   `WEBVIEW_REQUEST_TYPES`.
4. Dispatch `case` in the receiving half:
   - host receives: `src/provider/webviewMessageRouter.ts` + a callback in
     `piViewProvider`'s router options;
   - browser receives: `webview/hostMessageHandler.ts`.
5. A test in `test/unit/shared/protocol.test.mjs` (or the matching unit suite).

Missing step 4 fails `tsc` through `assertNever`; missing step 3 fails `tsc`
through the coverage assertion. Missing step 1–2 is caught only by review.

## 5. Correlation and request/response hygiene

- Webview → host requests carry a caller-made id: `crypto.randomUUID()` for
  actions, `requestId` for listings/media/mentions.
- Every message carrying `actionId` is answered on exactly one channel:
  `{ type: "actionResult", actionId, ok, cancelled?, error? }`. A handler that
  forgets to answer leaves the renderer spinning forever.
- Host → pi calls have their own `id` (`randomUUID`) registered *before* the
  write; see [host/rpc-transport.md](../host/rpc-transport.md).

## 6. Anti-patterns

| Anti-pattern | Consequence |
|--------------|-------------|
| `as WebviewToHostMessage` on a raw `postMessage` payload | Skips bounding/rebuilding; forged fields reach handlers |
| Adding a `parse*` branch that throws on the Webview boundary | A stale Webview can take down the sidebar |
| Widening an enum to `string` instead of `(string & {})` | Future values start failing validation |
| Duplicating a `MAX_*` constant locally when both halves must agree | Host and browser drift, one side truncates silently |
| Adding a message type and handling it in `main.ts` only | `hostMessageHandler` switch is the documented dispatch point; unknown types fall through intentionally |
| Casting pi event fields directly in the Webview | Bypasses `jsonValues.ts`; breaks on unknown shapes |

## 7. Verification

```powershell
npm run typecheck                 # catches the two exhaustiveness gates
node --test test/unit/shared/protocol.test.mjs
```
