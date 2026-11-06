# Pi Agent for VS Code

[English](https://github.com/dairycode/pi-agent-sidebar/blob/main/README.md) · [简体中文](https://github.com/dairycode/pi-agent-sidebar/blob/main/README.zh-CN.md)

A VS Code auxiliary-sidebar client for [pi](https://pi.dev), built on pi's public
RPC protocol.

The extension is deliberately thin: it spawns the `pi` you already have, in RPC
mode, in the extension host, and renders what pi reports. Conversation state,
tools, diffs, sessions, and slash commands are all pi's. The sidebar is the only
thing this extension adds.

Source: <https://github.com/dairycode/pi-agent-sidebar>

## Preview

![Pi Agent Sidebar running in the VS Code auxiliary sidebar](https://origin.picgo.net/2026/08/30/snapshot65fc55d47c1fd643.png)

## Requirements

| Requirement | Notes |
| --- | --- |
| VS Code 1.129 or newer | The view lives in the **auxiliary** sidebar (secondary side bar) |
| `pi` 0.81.0 or newer | Must be installed and authenticated |
| A trusted workspace folder | The extension stays disabled in untrusted workspaces |

Install and authenticate pi first — the extension cannot work without it:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
/login
```

## Install and open

1. Run **Pi Agent: Open** from the Command Palette, or click the pi icon in the
   editor title bar.
2. The view opens in the auxiliary sidebar. Move it to the primary side bar with
   VS Code's own *Move View* command if you prefer it there.
3. Type a prompt. Everything else — models, tools, approvals — behaves the way it
   does in the pi CLI, because it *is* the pi CLI.

## Features

### Conversation

- **Streaming transcript** — pi's text, reasoning, and tool execution render live,
  themed to the current VS Code color scheme.
- **Turn folding** — a turn's reasoning and tool calls fold into one line that
  counts the turn's tools, opens while the turn runs, and closes once it settles
  unless you toggled it. The answer keeps its own Copy / Branch / Regenerate row
  after it finishes.
- **Tool timeline with diffs** — file edits render as added, removed, and context
  lines; `path/file.ts:42` mentions in a response open the file at that line.
- **Diagrams** — `mermaid` fences in pi's messages become diagrams tinted by the
  active theme, with the source one click away. The library is bundled and only
  parsed once a diagram appears; a fence in your own message stays as source.
- **Native dialogs** — pi extension prompts and trusted-domain confirmations use
  native VS Code UI rather than a webview imitation.

### Sessions

- Persistent history with search, switching, rename, delete, and new sessions.
- The session last used in a workspace is restored after a VS Code reload.
- Export any session to a self-contained HTML file.
- Sessions live where pi puts them (`~/.pi/agent/sessions` by default), so the CLI
  and the sidebar see the same history — and `piAgentSidebar.sessionDirectory`
  moves both together.

### Composer

- **Inline references** — `@path` and `@path#line` references insert as clickable
  chips. `Cmd`/`Ctrl`-click or `F12` jumps back to the source.
- **File mentions** — type `@` to browse the workspace one level at a time; pick a
  folder to enter it, then `Enter` on a file. Folder references pass only the
  directory path so pi inspects it on demand.
- **Attachments** — the `+` button attaches files or images as chips; pasted PNG,
  JPEG, GIF, and WebP images use the same flow.
- **Slash commands** — type `/` to browse pi's extension commands, prompt
  templates, and skills, grouped by source with live filtering.
- **Queue and abort** — queue follow-up prompts while pi is working, or stop the
  active run. Transient provider errors (overload, rate limit, 5xx, interrupted
  streams) retry automatically.
- **Model and thinking level** — switch both from themed pickers in the composer.

### Editor integration

- A right-click **Pi Agent** submenu explains the selection, adds it to the
  composer with no preset instruction, refactors it, generates tests, explains
  reported problems, or explains the whole file.
- **Fix with Pi** appears as a quick fix for the diagnostic under the cursor.
- Explorer's **Pi Agent: Add Files or Folders to Input** action — or holding `Shift`
  while dragging files from Explorer anywhere over the sidebar — inserts the same
  inline references.

### Commands

| Command | What it does |
| --- | --- |
| Pi Agent: Open | Reveal the sidebar |
| Pi Agent: Focus Input with Selection | Open, focus the composer, insert the selection reference |
| Pi Agent: New Session | Start a fresh session |
| Pi Agent: New Trellis Task | Create a Trellis task through `.trellis/scripts/task.py` when the workspace has a Trellis layout |
| Pi Agent: Rename Session | Rename the current session |
| Pi Agent: Export Session to HTML | Write the current session out as a standalone page |
| Pi Agent: Explain Selection / Explain File / Refactor Selection / Generate Tests / Explain Problems in Selection | Preset prompts for the editor selection or file |
| Pi Agent: Add Files or Folders to Input | Attach Explorer selections to the composer |
| Pi Agent: Restart Runtime | Kill and respawn the pi process |
| Pi Agent: Show Logs | Open the extension's output channel |

> Command Palette labels currently ship in Simplified Chinese (see
> [README.zh-CN.md](https://github.com/dairycode/pi-agent-sidebar/blob/main/README.zh-CN.md) for the Chinese label of each entry).

## Keyboard shortcut

Select code, then press `Cmd+Esc` (macOS) or `Ctrl+Esc` (Windows / Linux). The
sidebar opens, the composer focuses, and an inline reference such as
`@src/file.ts#10-14` is inserted at the caret while the selected text itself
travels along as code context. Delete the reference to detach it; `Cmd`/`Ctrl`-click
it or press `F12` inside it to jump back. With no selection, the shortcut only
focuses the composer.

Other AI extensions may claim the same chord — reassign **Pi Agent: Focus Input
with Selection** in VS Code's Keyboard Shortcuts editor if it conflicts.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `piAgentSidebar.binaryPath` | `pi` | Path to the pi executable. Use an absolute path when `pi` is not on `PATH`. |
| `piAgentSidebar.additionalArguments` | `[]` | Extra arguments passed to pi before RPC mode. Session and run-mode arguments are managed by the extension. |
| `piAgentSidebar.sessionDirectory` | `""` | Session storage directory (`--session-dir`). Absolute, or relative to the workspace folder. Empty means pi's default. |
| `piAgentSidebar.trustProjectResources` | `true` | Load project-local pi settings, extensions, skills, and prompts once the workspace is trusted. |
| `piAgentSidebar.restoreSession` | `true` | Restore the last session in this workspace after a reload. |
| `piAgentSidebar.autoRetry` | `true` | Retry transient provider errors. |

`binaryPath`, `additionalArguments`, and `sessionDirectory` are machine-scoped;
the rest are workspace-overridable. Against pi, `autoRetry` maps to pi's own
`set_auto_retry` RPC — the extension does not implement retry logic itself.

## Troubleshooting

**VS Code cannot find `pi`.** Set `piAgentSidebar.binaryPath` to an absolute path
such as `/opt/homebrew/bin/pi` or `C:\Users\you\AppData\Roaming\npm\pi.cmd`.

**Windows.** npm installs `pi` as a `.cmd` shim that cannot be spawned directly.
With `binaryPath` left at its default, the extension tries `pi` and then falls back
to running `node.exe` with the globally installed pi entry script as its first
argument (the script is read from the package's own `bin` field). Set `binaryPath`
to anything other than `pi` to override that fallback.

**The view stays disabled.** The workspace is untrusted. Trust the folder — pi can
read, edit, and execute files with your permissions, so the extension refuses to
start in restricted mode.

**"Older than the tested minimum" warning.** The installed pi is below 0.81.0;
upgrade pi rather than ignoring it, since RPC behavior may have changed.

**Nothing renders but pi works in the terminal.** Open **Pi Agent: Show Logs** and
check the runtime line for the binary and version actually launched.

## Security model

The extension does not sandbox pi. pi's default coding tools can read, edit, and
execute files with the extension host's permissions. Mitigations:

- The view is disabled in untrusted workspaces and only passes `--approve` for
  project-local pi resources after VS Code has established trust.
- The configured binary is launched without a shell.
- Transcript Markdown is sanitized before it reaches the DOM, and the webview runs
  under a CSP that only allows scripts carrying the document nonce. Mermaid is the
  one addition the CSP makes room for: the inserted SVG keeps its own styles, so
  `style-src` also allows inline styles, and the SVG is inserted with scripts,
  event-handler attributes, and executable `href` values stripped.

Session files are pi's, under `~/.pi/agent/sessions` unless reconfigured. They can
contain source code, tool output, and other sensitive conversation data — treat
them like shell history.

The extension collects no telemetry and makes no network requests of its own; all
provider traffic belongs to the pi process.

## Development

```bash
npm install
npm run build          # bundle extension + webview (+ mermaid bundle)
npm run watch          # rebuild on change
npm run verify         # typecheck + unit/integration tests + generated-code check
npm run preview        # build, then render the webview in a plain browser
npm run package        # verify, production build, then vsce package
```

Layout:

```
src/        extension host: view provider, RPC client, pi process lifecycle
webview/    the sidebar UI (transcript, composer, sessions, transcript media)
shared/     code and protocol types used by both sides
scripts/    build, preview, and smoke-test entry points
test/       unit and integration suites (node:test)
```

See [CONTRIBUTING.md](https://github.com/dairycode/pi-agent-sidebar/blob/main/CONTRIBUTING.md) for review expectations and commit
conventions.

## License

[MIT](https://github.com/dairycode/pi-agent-sidebar/blob/main/LICENSE)
