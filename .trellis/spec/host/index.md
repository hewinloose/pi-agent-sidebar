# Extension Host Specs

> Conventions for `src/` — the VS Code side: activation, the Webview provider,
> the pi process transport, and the services that touch the disk or the editor.

---

## Files


| File | Answers |
|------|---------|
| [provider-and-lifecycle.md](./provider-and-lifecycle.md) | Where host logic goes, how the provider is structured, disposed, and kept race-free |
| [rpc-transport.md](./rpc-transport.md) | How the extension talks to the pi child process |
| [webview-boundary.md](./webview-boundary.md) | How messages enter and leave the Webview from the host side |
| [session-history.md](./session-history.md) | How delete / edit / regenerate rebuild a session without touching the file pi holds |

---

## Directory map

```
src/
├── extension.ts            activation: commands, status bar, output channel, deactivate
├── webviewDocument.ts      the only HTML/CSP factory for the Webview
├── provider/               UI orchestration and provider operations
│   ├── piViewProvider.ts   WebviewViewProvider; owns runtime, snapshot, and message flow
│   ├── webviewMessageRouter.ts   WebviewToHostMessage → provider callbacks
│   ├── extensionUiController.ts  pi's extension-UI requests (select/confirm/input)
│   ├── composerReferenceStore.ts  reference ranges and workspace path resolution
│   ├── asyncQueue.ts             serial queue primitive
│   ├── deliveryPolicy.ts, notificationPolicy.ts, sessionMutation.ts, missedReplies.ts
│   │                             pure decision modules (no vscode, no I/O)
├── rpc/                    pi process: probe, spawn, framing, validation
│   ├── piRpcClient.ts      transport (spawn, newline JSON, pending map, stop)
│   ├── rpcValidation.ts    parse* for every pi payload (throws on bad shape)
│   ├── piCapabilities.ts, binaryProbe.ts, windowsPiLaunch.ts
└── services/               leaf services; `vscode` only where the editor API is needed
    ├── attachmentStore.ts, promptBuilder.ts   vscode-free
    ├── sessionStore.ts                        pi's session bookkeeping, node only
    └── workspaceResources.ts, workspaceFileSearch.ts, transcriptMedia.ts
```

Directory names are lowercase and singular. `src/webviewDocument.ts` stays at the
`src/` root because both the provider and the preview tooling use it.

---

## Naming conventions

| Kind | Convention | Examples |
|------|------------|----------|
| Files | `camelCase.ts`, one concern per file | `piViewProvider.ts`, `rpcValidation.ts`, `missedReplies.ts` |
| Classes | `PascalCase` + role suffix | `PiRpcClient`, `ComposerReferenceStore`, `ExtensionUiController`, `MissedReplyQueue` |
| Data shapes | `interface` by default; `type` only for unions/aliases | `interface PiRpcClientOptions`, `type HostToWebviewMessage` |
| Pure policy | lowercase module of standalone functions | `deliveryPolicy.ts → streamingBehaviorFor` |
| Validation / guards | `parse*`, `validate*`; `assert*` throws; `is*`/`should*` return boolean; `create*` builds | `parsePiState`, `assertSessionMutationAllowed`, `isReplayableReply`, `createWebviewDocument` |
| Constants | `UPPER_SNAKE`, module scope, unit in the name | `MAX_RECORD_BYTES`, `DEFAULT_TIMEOUT_MS`, `SNAPSHOT_MESSAGE_LIMIT` |
| Class members | explicit `public`/`private`, `private readonly` dependencies, `override` where required | `private readonly output: vscode.OutputChannel` |

## Module mechanics

- ESM under `module: NodeNext`: **every relative import ends in `.js`**
  (`import { PiRpcClient } from "./piRpcClient.js"`), and type-only imports use
  `import type`.
- Node-only modules declare the environment on line 1:
  `/// <reference types="node" />` (see [piRpcClient.ts](../../../src/rpc/piRpcClient.ts),
  [sessionStore.ts](../../../src/services/sessionStore.ts),
  [binaryProbe.ts](../../../src/rpc/binaryProbe.ts)).
- Indentation is tabs (`.prettierrc`: `useTabs: true`, `tabWidth: 2`). Prettier is
  not installed and there is no lint step, so match the file you edit and never
  reformat a file as a side effect. See [quality/code-style.md](../quality/code-style.md).
- Comments are design records. Non-obvious host code carries a comment naming the
  failure mode that forced the code (see the session-path comment in
  [sessionStore.ts](../../../src/services/sessionStore.ts) explaining why
  collapsing path runs breaks Windows session history).
