# pi RPC Transport

> `src/rpc/piRpcClient.ts` speaks pi's public RPC protocol over a child process.
> It is the only module allowed to spawn pi or frame its messages.

---

## When this applies

Any change to process launch, stream framing, request correlation, timeouts,
shutdown, or pi response validation.

---

## 1. Spawn

[piRpcClient.ts:71](../../../src/rpc/piRpcClient.ts):

```ts
const child = spawn(this.options.binary, this.options.args, {
  cwd, env,
  shell: false,
  stdio: ["pipe", "pipe", "pipe"],
  detached: process.platform !== "win32",
});
```

- `shell: false` and an argument **array** — never interpolate into a command line.
- `detached` on POSIX puts pi in its own process group so the whole group can be
  signalled (`signalGroup`, [piRpcClient.ts:405](../../../src/rpc/piRpcClient.ts)).
  Windows has no process groups, so the direct child is signalled and the platform
  helper in `windowsPiLaunch.ts` handles resolution.
- Binary resolution and launch arguments live in `binaryProbe.ts` /
  `windowsPiLaunch.ts`; the client never guesses a path.
- A spawn error rejects `start()`. A runtime `error` event is downgraded to a
  `protocolError` event instead of killing the client.
- Capabilities are probed once (`piCapabilities.ts`) and gate optional features;
  do not assume a command exists in the running pi version.

## 2. Framing

Newline-delimited JSON in both directions:

- Outbound: `JSON.stringify(record) + "\n"`.
- Inbound: buffered on `"\n"` and decoded with `StringDecoder("utf8")` — **never**
  `chunk.toString()`, which corrupts a multi-byte character split across chunks.
  A trailing `\r` is stripped.
- `MAX_RECORD_BYTES = 64 MB` ([piRpcClient.ts:9](../../../src/rpc/piRpcClient.ts)):
  an oversized inbound record rejects all pending requests and the buffer is
  discarded to the next newline.
- Unparsable or non-object lines become `protocolError` events and are dropped.
  Never throw from the read loop.

## 3. Correlation

`request(command, timeoutMs = DEFAULT_TIMEOUT_MS)` ([piRpcClient.ts:120](../../../src/rpc/piRpcClient.ts)):

1. `const id = randomUUID()`.
2. The pending entry is registered in `Map<string, PendingRequest>` **before** the
   write, so a fast reply cannot arrive unowned.
3. `writeRecord({ ...command, id })`.
4. If the write fails, the pending entry is rejected and removed.

A response rejects the pending entry when: `success === false` (uses
`record.error`), `success` is not a boolean, `id` is invalid or oversized, the
`command` does not match the request, `error` is malformed, the timeout fires, the
process exits, or the record is oversized. Success resolves `record.data` as
`unknown`; the caller runs it through a `parse*` from `rpcValidation.ts`.

- Default timeout is 30 s. Long operations pass their own constant — the provider
  uses a 10-minute constant for compaction. Do not silently raise the default.
- `notify(command)` ([piRpcClient.ts:160](../../../src/rpc/piRpcClient.ts)) is the
  no-response path, used for `extension_ui_response`.

## 4. Stop

`stop()` ([piRpcClient.ts:165](../../../src/rpc/piRpcClient.ts)) is a staged
shutdown; preserve the order and the timings:

1. Best-effort `{ type: "abort" }` (may already be closed).
2. `stdin.end()` — pi exits on EOF.
3. SIGTERM to the whole group at 500 ms if still alive.
4. SIGKILL at 1.5 s.
5. Reject at 3 s if the process still has not exited.

All timers are `.unref()`d so they never hold the host process open. On exit the
group is signalled once more to sweep tools pi left behind — see the comment at
[piRpcClient.ts:192](../../../src/rpc/piRpcClient.ts) explaining why the group id
cannot have been reused.

## 5. Validation boundary

`rpcValidation.ts` is the only place pi payloads become typed. Read
[architecture/protocol-and-validation.md](../architecture/protocol-and-validation.md)
for the three failure modes; the transport-specific rules are:

- Every payload has an exported `parse*` entry; optional snapshot sections go
  through `parseOptionalSnapshot` so one failed command does not blank the state.
- `ProtocolValidationError` is thrown by the parser, caught by the provider, and
  logged. Bad events are dropped, not fatal.
- Parsers are pure and testable with no child process.

## 6. Anti-patterns

| Anti-pattern | Why |
|--------------|-----|
| `shell: true`, or building a command string | Injection and quoting bugs; the launch path is already tested per platform |
| Awaiting `notify()` and expecting a reply | It never correlates; use `request()` |
| Adding a `setTimeout` retry inside the client | Retry policy belongs to the provider (`piAgentSidebar.autoRetry` and `deliveryPolicy`) |
| Reading stdout without `StringDecoder` | Corrupts multi-byte UTF-8 at chunk boundaries |
| Throwing from the line parser | Kills the read loop and orphans pending requests |
| Using a private pi argument shape instead of the RPC protocol | Breaks on any pi release; see [AGENTS.md](../../../AGENTS.md) |

## 7. Tests

- Transport: [test/unit/host/rpc-client.test.mjs](../../../test/unit/host/rpc-client.test.mjs)
  spawns a **real** child process (`test/fixtures/fake-rpc.mjs`) with
  `binary: process.execPath`. Protocol pathologies are command names
  (`mismatched_command`, `invalid_success`, `unidentified_response`, `exit_now`,
  `hang`, `spawn_helper`), including a UTF-8 sequence split mid-character.
- Validation: [test/unit/host/rpc-validation.test.mjs](../../../test/unit/host/rpc-validation.test.mjs).
- Opt-in live check: `npm run test:rpc` (`scripts/rpc-smoke.mjs`) needs a real
  `pi` binary and is **not** part of `npm run verify`.
