# Extension Host Layer (`src/`) — Coding Conventions

Derived from actual code in `src/`, `shared/`, `package.json`, `tsconfig.json`,
`test/`, `scripts/`. No aspirational claims; inconsistencies are called out.

## 1. Layering and import direction

Layers, verified by reading every `import ... from "..."` under `src/`, `shared/`, `webview/`:

| Layer | Dir | May import (verified) |
|---|---|---|
| protocol/types, platform-neutral | `shared/` | only `shared/` siblings; no `vscode`, no `node:*`, no `src/` |
| pi transport + validation, pure Node | `src/rpc/` | `node:*` and `shared/` only — **zero `vscode` imports** |
| domain services | `src/services/` | `node:*`, `shared/`, sibling services; `vscode` only where the editor API is genuinely needed (`workspaceResources`, `workspaceFileSearch`, `transcriptMedia`) — `attachmentStore`, `sessionStore`, `promptBuilder` stay vscode-free |
| UI/orchestration | `src/provider/` | `../rpc/*`, `../services/*`, `../../shared/*`, `vscode`, siblings, `../webviewDocument.js` |
| activation | `src/extension.ts` | **only** `./provider/piViewProvider.js` + `vscode` |

Forbidden directions that hold in the code:

- `src/rpc/**` never imports `provider/`, `services/`, or `vscode`. Hence
  `PiRpcClient.onEvent(): () => void` unsubscribe closures instead of
  `vscode.Disposable` (`src/rpc/piRpcClient.ts:47-66`).
- `src/services/**` never imports `provider/` or `rpc/`; `extension.ts` never reaches
  into `rpc/` or `services/`. `shared/` is the only code imported by both host and
  webview; `webview/*` never imports `src/`.
- `src/webviewDocument.ts` sits at the `src/` root as the single HTML/CSP factory, not
  under `provider/`. Directory names are lowercase singular.

## 2. Activation (`src/extension.ts`)

- `activate(context): void` is the only place touching `vscode.commands.register*`,
  `createOutputChannel`, `createStatusBarItem`; command handlers are one-liners
  delegating to `PiViewProvider` methods.
- **Every registration is pushed into one `context.subscriptions` call** (`:60-146`).
  `createOutputChannel("Pi Agent", { log: true })` (`:56`); command IDs live in
  `package.json` and are asserted by `test/integration/manifest.test.mjs`.
- `deactivate()` awaits `provider.shutdown()` (`:150-156`), the same idempotent
  promise `dispose()` fires. Fire-and-forget handlers are always wrapped:
  `provider.renameSession().catch((error: unknown) => { void vscode.window.showWarningMessage(...) })`.

## 3. Talking to pi (`src/rpc/`)

**Spawn** (`piRpcClient.ts:71-118`): `spawn(binary, args, { cwd, env, shell: false,
stdio: ["pipe","pipe","pipe"], detached: process.platform !== "win32" })` —
`shell: false` always and args are an array; `detached` on POSIX so the whole process
group can be signalled (Windows signals the direct child only, `signalGroup`, `:405`).
Initial spawn errors reject `start()`; runtime `error` events are downgraded to a
`protocolError` event (`:203-215`).

**Framing** (`:235-300`): newline-delimited JSON both ways. Outbound is
`JSON.stringify(record) + "\n"`; inbound is buffered on `"\n"` through
`StringDecoder("utf8")` (never `chunk.toString()`) and a trailing `\r` is stripped.
`MAX_RECORD_BYTES = 64MB` rejects all pending requests and discards to the next
newline (`:246-266`). Unparsable or non-object lines become `protocolError` events
and are dropped, never thrown.

**Correlation** (`:120-158`): `const id = randomUUID()`; the pending entry is
registered in `Map<string, PendingRequest>` **before** the write, then
`writeRecord({ ...command, id })`. A response is rejected on: `success === false`
(uses `record.error`), non-boolean `success`, invalid/oversized `id`, `command`
mismatch with the request, malformed `error`, timeout, process exit, oversize record.
Success resolves `record.data` as `unknown`; the caller runs it through a `parse*`
function. `DEFAULT_TIMEOUT_MS = 30_000`, overridable per call — long ops pass their
own: `client.request({ type: "compact" }, LONG_COMMAND_TIMEOUT_MS)` (10 min,
`piViewProvider.ts:66,772`). `notify(command)` is the no-response path (used for
`extension_ui_response`). `stop()` (`:165`): `{type:"abort"}` → `stdin.end()` →
SIGTERM at 500 ms → SIGKILL at 1.5 s → reject at 3 s, timers `.unref()`.

**Inbound validation** (`rpcValidation.ts`) — throw-on-bad:

- `ProtocolValidationError extends Error {}` (`:26`), no custom `name`, no codes.
  Callers decide what a throw means: a bad event is logged and dropped
  (`piViewProvider.ts:1226-1232`); optional snapshot sections fall back through
  `parseOptionalSnapshot` (`:1345`).
- Every payload has an exported `parse*` entry (`validateRpcEvent` only for the
  pass-through event case): `parsePiState`, `parseMessagesResponse`,
  `parseMessagesWindow`, `parseModelsResponse`, `parseThinkingLevelsResponse`,
  `parseCommandsResponse`, `parsePiStats`, `parseSessionChangeResult`,
  `parseForkMessagesResponse`. Parsers return the **original object cast**
  (`return state as PiState`) after field checks — no cloning, no reshaping.
- Private primitives at the bottom always take a `label` path: `record`, `array`,
  `string`, `optionalString`, `nonEmptyString`, `optionalBoolean`, `optionalNumber`,
  `optionalNonNegativeInteger`, `optionalTimestamp`, `optionalNullableNumber`.
  Messages interpolate it (`` `${label} must be a string.` `` →
  `messages[3].content must be an object.`). Bounds are module-level `UPPER_SNAKE`
  consts at the top of the file.
- Leniency is localized and commented: bad rows are dropped rather than failing a
  list (`parseCommandsResponse`, `:113-121`); the dropped tail of a message window is
  deliberately not validated (`parseMessagesWindow`, `:60-99`).

## 4. Webview boundary (host side)

- Inbound: `parseWebviewMessage(value: unknown): WebviewToHostMessage | undefined`
  (`shared/protocolParser.ts:17`) **returns `undefined` for invalid input** — the
  opposite of `rpcValidation`; caller logs `"[webview] Ignored an invalid message."`
  (`piViewProvider.ts:655-663`).
- Dispatch is `switch (message.type)` ending in `default: assertNever(message)`
  (`webviewMessageRouter.ts:44,134`); `shared/assertNever.ts` makes a missing branch
  a build error (same pattern in `webview/hostMessageHandler.ts:74`). The router holds
  no state: one flat `WebviewMessageRouterOptions` of `onXxx(): Promise<void>`
  callbacks (24), wired in the provider constructor (`piViewProvider.ts:188-262`).
  Messages carrying `actionId` go through `respondToAction`, which always posts back
  `{type:"actionResult", actionId, ok, cancelled?, error?}`.
- Outbound: everything funnels through `private async post(message:
  HostToWebviewMessage): Promise<boolean>` (`piViewProvider.ts:1717`), which also
  drives the status bar and handles the hidden-view drop. Nothing else calls
  `webview.postMessage`.

## 5. Error handling and logging

- **No Result/Either types in the host.** Errors are thrown (`new Error("...")`) and
  caught at boundaries. A result-like shape exists only over the webview boundary:
  `{ type: "actionResult", ok, cancelled?, error? }` (`shared/protocol.ts:199-205`).
- Sentinel subclasses caught by `instanceof`: `RuntimeUnavailableError`
  (`piViewProvider.ts:119`, swallowed — the view already shows connection state),
  `SessionMutationCancelledError` (`:126` → `actionResult { ok: true, cancelled: true }`,
  `:1375-1385`), `ProtocolValidationError`.
- Three user-surfacing channels, chosen deliberately: `actionResult` (command failed,
  session fine), `{type:"connection", phase:"error"}` (fatal banner),
  `{type:"notice", kind:"error"}` (non-fatal). Per `shared/protocol.ts:276-283`: "A
  refused `mailto:` link, a path outside the workspace, or a missing workspace folder
  all used to travel on that channel and took the whole sidebar down with them."
  Command-palette paths use `showWarningMessage`; webview paths use `actionResult`;
  background failures are logged only.
- `toErrorMessage(error: unknown)` is **re-declared per module**, not shared
  (`piViewProvider.ts:1771`, `extensionUiController.ts:137`,
  `composerReferenceStore.ts:518`, `workspaceResources.ts:239`) — the only narrowing
  idiom is `error instanceof Error ? error.message : String(error)`. Never `throw` a
  non-`Error`; strings are only returned by validators.
- Logging is always `this.output.appendLine(\`[tag] ${detail}\`)` with one bracketed
  subsystem tag (`[runtime]`, `[protocol]`, `[snapshot]`, `[webview]`,
  `[extension-ui]`, `[session]`, `[media]`, …). Child stderr is appended verbatim
  (`append`, not `appendLine`). `void` marks deliberate fire-and-forget.

## 6. Naming conventions

| Kind | Convention | Examples |
|---|---|---|
| Files | `camelCase.ts`, one concern each | `piViewProvider.ts`, `rpcValidation.ts`, `missedReplies.ts` |
| Classes | `PascalCase` + role suffix | `PiRpcClient`, `ComposerReferenceStore`, `ExtensionUiController`, `MissedReplyQueue` |
| Object shapes | `interface` (40) ≫ `type` (12); `type` for unions only | `interface PiRpcClientOptions`, `type HostToWebviewMessage` |
| Policies | lowercase module of pure functions | `deliveryPolicy.ts → streamingBehaviorFor`, `notificationPolicy.ts → notificationDestination`, `sessionMutation.ts → sessionMutationBlockReason` |
| Validation, guards, predicates | `parse*`/`validate*`; `assert*` throws; `is*`/`should*` → boolean; `create*` for factories | `parsePiState`, `validateRpcEvent`, `assertSessionMutationAllowed`, `isReplayableReply`, `createWebviewDocument` |
| Constants | `UPPER_SNAKE` module-scope, size in the name | `MAX_RECORD_BYTES`, `DEFAULT_TIMEOUT_MS`, `SNAPSHOT_MESSAGE_LIMIT` |
| Modifiers | explicit `public`/`private` on every member, `private readonly` deps, `override` required | `private readonly output: vscode.OutputChannel` |

Formatting: `.prettierrc` = `{ "useTabs": true, "tabWidth": 2 }` (tabs are house
style). **No ESLint config exists** — `typecheck` + tests are the gate. ESM specifiers
always carry `.js` (`module: NodeNext`); Node-only modules start with
`/// <reference types="node" />` (`piRpcClient.ts:1`, `sessionStore.ts:1`).

## 7. Lifecycle / disposal

The provider implements `vscode.Disposable` **and** exposes an idempotent
`shutdown()` memoized in `shutdownPromise` (`piViewProvider.ts:651-653`, `:476-495`):

```ts
public shutdown(): Promise<void> {
  if (this.shutdownPromise) return this.shutdownPromise;
  this.disposed = true;
  this.shutdownPromise = (async () => { ... })();
  return this.shutdownPromise;
}
public dispose(): void { void this.shutdown(); }
```

`deactivate()` awaits `shutdown()`; `dispose()` is the sync fire-and-forget variant —
new teardown work goes inside the async body, not in `dispose()`.

- Services holding `vscode` listeners implement `vscode.Disposable` and collect
  children in `disposables: vscode.Disposable[]` (`workspaceFileSearch.ts:32,62-65`);
  expensive listeners are created lazily on first use, not in the constructor
  (`workspaceFileSearch.ts:40-60`). View-scoped listeners chain to the view:
  `onDidDispose` disposes the message listener, the visibility listener, and itself
  (`piViewProvider.ts:298-310`).
- `src/rpc/` event sources use `EventEmitter` + `on*(): () => void` closures, keeping
  the layer vscode-free. Idempotency is promise-memoized, not boolean-flagged:
  `startPromise`, `shutdownPromise`, `initializationPromise`
  (`attachmentStore.ts:50-60`), `cached` (`windowsPiLaunch.ts:156`).

## 8. Concurrency and staleness guards

- Session mutations serialize through `AsyncQueue` (`asyncQueue.ts:1`) via
  `enqueueSessionMutation(operation, { requireIdle })` (`piViewProvider.ts:968`):
  captures `workspaceGeneration`, increments `sessionMutationPending`, re-asserts
  context around every await. `assertNoSessionMutationPending()` guards double
  submit of new/clone/fork.
- Generation counters invalidate in-flight work: `workspaceGeneration` (bumped on
  workspace change/shutdown) and `snapshotSequence` (late snapshots dropped,
  `:1258-1267`); each `doStartClient` step re-checks the generation and returns early.
  Client identity is re-checked on every listener (`if (this.client !== client)
  return;`, `:1208`, `:1236`; `isCurrentClient` in `ExtensionUiController`).
- `Promise.allSettled` + per-result fallback (`parseOptionalSnapshot`, `:1345`) so one
  failing RPC does not blank the snapshot; only `get_state`/`get_messages` are hard
  requirements.

## 9. Verbatim rules and gotchas

Design/security (`CONTRIBUTING.md`, `AGENTS.md`, `shared/assertNever.ts:2-12`):

> "Use pi's public RPC protocol. Do not rely on private tool argument shapes or
> internal pi behavior."

> "Treat all Webview messages, RPC events, file paths, URIs, and persisted state as
> untrusted input. Validate and bound data at the receiving boundary."

Platform gotchas:

> "Its own process group, so the group can be signalled as a whole ... a signal sent
> to pi alone leaves those children running after the client stops."
> (`piRpcClient.ts:84-93`)

> "Must match pi's getDefaultSessionDirPath character for character ... Collapsing
> runs turns the Windows drive prefix `C:\Users\...` into `--C-Users-...--` while pi
> writes `--C--Users-...--` so the session history silently comes up empty."
> (`sessionStore.ts:30-34`)

Webview gotchas:

Boundary/scope gotchas:

> "setStatus is intentionally not forwarded: the webview owns transient status."
> (`extensionUiController.ts:38`)

> "This is not a one-line strip. A character class such as `[./]` removes the dot from
> `.vscode/settings.json` ... and it also removes the leading `../` that the traversal
> check needs to see." (`workspaceResources.ts:39-52`)

Path-safety suppressions use `// pi-lens-ignore: ts-path-traversal -- <reason>`
directly above the call (`sessionStore.ts:52-355`); the reason is mandatory — an
audit trail, not a mute.

## 10. Testing conventions (host)

- Node's built-in runner, `.test.mjs`, `test/unit/host/`; no Jest/Mocha. TS modules
  are esbuild-bundled on demand via `loadBundledModule({ entry:
  "src/provider/deliveryPolicy.ts", name: "delivery-policy" })`
  (`test/helpers/load-bundled-module.mjs:16`), with `loaded.dispose()` in `finally`.
  `vscode` is mocked with per-test esbuild plugins; no `vscode` shim exists.
- Pure functions are extracted to be testable this way (`deliveryPolicy`,
  `notificationPolicy`, `missedReplies`, `sessionMutation`, `rpcValidation`,
  `piCapabilities`); injectable-dependency interfaces are the seam for platform code
  (`WindowsPiLaunchDeps`, `MediaPathResolver`). Gate: `typecheck && test:unit &&
  check-generated` (`verify`), on Ubuntu and Windows in CI.

## 11. Unverified

- No lint rules beyond `tsc`; anything not expressible in `tsconfig` is unenforced.
- No ADRs — rationale lives in code comments only. Whether the unsubscribes from
  `PiRpcClient.on*` are retained: not verified beyond `attachClientListeners` ignoring
  them (the client is replaced wholesale).
- The vscode-dependent vs vscode-free split inside `src/services/` is observed, not
  documented in the repo — a pattern, not a stated rule.
