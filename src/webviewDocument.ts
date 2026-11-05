import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

export function createWebviewDocument(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
): string {
	const nonce = randomBytes(24).toString("base64url");
	const webviewRoot = vscode.Uri.joinPath(extensionUri, "dist", "webview");
	const scriptUri = webview.asWebviewUri(
		vscode.Uri.joinPath(webviewRoot, "main.js"),
	);
	const styleUri = webview
		.asWebviewUri(vscode.Uri.joinPath(webviewRoot, "main.css"))
		.with({ query: `v=${nonce}` });
	const codiconUri = webview.asWebviewUri(
		vscode.Uri.joinPath(webviewRoot, "codicons", "codicon.css"),
	);
	// Mermaid is a few megabytes, so it is not part of the main bundle: the
	// webview injects this one with the nonce below when the first diagram
	// appears. Only the URL travels in the markup; nothing loads it up front.
	const mermaidUri = webview.asWebviewUri(
		vscode.Uri.joinPath(webviewRoot, "mermaid.js"),
	);

	return `<!doctype html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<link rel="stylesheet" href="${codiconUri}">
	<link rel="stylesheet" href="${styleUri}">
	<title>Pi Agent</title>
</head>
<body data-csp-nonce="${nonce}" data-mermaid-script="${mermaidUri}">
	<div id="resource-drop-overlay" class="resource-drop-overlay" aria-hidden="true" hidden>
		<div class="resource-drop-prompt">
			<span>拖放以添加上下文</span>
		</div>
	</div>

	<div id="app">
		<header id="session-header" class="session-header">
			<div class="session-title-wrap">
				<span id="connection-dot" class="connection-dot" role="status" aria-label="Pi 正在启动"></span>
				<div id="session-title" class="session-title" title="未命名">未命名</div>
			</div>
			<div class="header-actions" role="toolbar" aria-label="会话操作">
				<button id="rename-session-button" class="icon-button" type="button" title="重命名会话" aria-label="重命名会话"><i class="codicon codicon-edit"></i></button>
				<button id="history-button" class="icon-button" type="button" title="会话历史" aria-label="会话历史" aria-controls="history-panel" aria-expanded="false"><i class="codicon codicon-history"></i></button>
				<button id="new-session-button" class="icon-button" type="button" title="新建会话" aria-label="新建会话"><i class="codicon codicon-add"></i></button>
				<button id="session-menu-button" class="icon-button" type="button" title="复制或分支此会话" aria-label="复制或分支此会话" aria-haspopup="menu" aria-controls="session-menu" aria-expanded="false"><i class="codicon codicon-ellipsis" aria-hidden="true"></i></button>
			</div>
		</header>

		<div id="transcript-frame" class="transcript-frame">
			<main id="transcript" class="transcript" role="log" aria-label="对话" aria-live="off">
				<div id="connection-banner" class="connection-banner" hidden></div>
				<div id="pinned-prompt-slot" class="pinned-prompt-slot">
					<div id="pinned-prompt" class="pinned-prompt" hidden>
						<button id="pinned-prompt-body" class="pinned-prompt-body" type="button" title="跳转到此消息" aria-label="跳转到此消息">
							<span id="pinned-prompt-text" class="pinned-prompt-text"></span>
						</button>
						<button id="pinned-prompt-toggle" class="pinned-prompt-toggle icon-button" type="button" hidden aria-expanded="false" aria-controls="pinned-prompt-text" title="展开此消息" aria-label="展开此消息"><i class="codicon codicon-chevron-down" aria-hidden="true"></i></button>
					</div>
				</div>
				<section id="empty-state" class="empty-state">
					<svg class="empty-logo" viewBox="0 0 256 256" width="54" height="54" aria-hidden="true">
						<rect class="empty-logo-plate" width="256" height="256" rx="48"/>
						<path class="empty-logo-glyph" d="M48 64h160v32h-24v112h-32V96h-48v112H72V96H48V64Z"/>
						<path class="empty-logo-mark" d="M104 112h48v32h-48z" opacity=".9"/>
					</svg>
					<div class="empty-wordmark">pi agent</div>
					<p id="empty-detail" class="empty-detail">正在此工作区启动…</p>
				</section>
				<div id="messages" class="messages"></div>
			</main>
			<button id="jump-to-bottom" class="jump-to-bottom" type="button" title="跳到最新" aria-label="跳到最新"><i class="codicon codicon-arrow-down" aria-hidden="true"></i></button>
		</div>

		<aside id="history-panel" class="history-panel" role="region" aria-label="会话历史" hidden>
			<div class="history-search" role="search">
				<i class="codicon codicon-search" aria-hidden="true"></i>
				<input id="session-search" type="search" placeholder="搜索会话…" aria-label="搜索会话" autocomplete="off" spellcheck="false">
			</div>
			<div id="session-list" class="session-list" aria-live="polite"></div>
		</aside>

		<aside id="fork-panel" class="history-panel fork-panel" role="region" aria-label="从较早的提示词分支" hidden>
			<p class="fork-hint">选择要分支的提示词。本会话仍保留在历史中。</p>
			<div class="history-search" role="search">
				<i class="codicon codicon-search" aria-hidden="true"></i>
				<input id="fork-search" type="search" placeholder="搜索提示词…" aria-label="搜索提示词" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="fork-list">
			</div>
			<div id="fork-list" class="session-list fork-list" role="listbox" aria-label="可分支的提示词" aria-live="polite"></div>
			<p id="fork-draft-warning" class="fork-draft-warning" hidden><i class="codicon codicon-warning" aria-hidden="true"></i>分支会替换你已输入的内容。</p>
		</aside>

		<div id="widget-area" class="widget-area" hidden></div>

		<footer id="composer-shell" class="composer-shell">
			<div id="composer-status-row" class="composer-status-row" hidden>
				<div id="queue-status" class="queue-status" hidden></div>
				<button id="runtime-meta" class="runtime-meta" type="button" hidden aria-haspopup="dialog" aria-expanded="false" aria-controls="usage-panel" title="会话用量详情"></button>
			</div>
			<div id="attachment-list" class="attachment-list" aria-label="附件"></div>
			<form id="composer" class="composer">
				<label class="sr-only" for="prompt-input">给 pi 发消息</label>
				<span id="prompt-input-help" class="sr-only">用 @ 开头可以引用文件或所选内容。输入 @ 搜索工作区文件，然后使用方向键和回车添加。把光标移到引用内部并按 F12 可打开其来源。按住 Shift 可以从 VS Code 资源管理器把文件拖入此输入框。pi 正在运行时，按 Alt 加回车会把消息排队作为后续指令。</span>
				<div id="prompt-editor" class="prompt-editor">
					<div class="prompt-highlight-backdrop" aria-hidden="true"><div id="prompt-highlights" class="prompt-highlights"></div></div>
					<textarea id="prompt-input" rows="1" placeholder="让 pi 构建、修复或解释…" aria-label="给 pi 发消息" aria-describedby="prompt-input-help"></textarea>
				</div>
				<div class="composer-toolbar">
					<div id="composer-tools" class="composer-tools">
						<button id="attach-button" class="icon-button" type="button" title="添加文件或图片" aria-label="添加文件或图片"><i class="codicon codicon-add"></i></button>
						<button id="command-button" class="icon-button" type="button" title="斜杠命令" aria-label="斜杠命令" aria-haspopup="listbox" aria-controls="command-panel" aria-expanded="false"><svg class="slash-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11 2.59L5 13.35" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>
						<button id="model-select" class="select-control model-control" type="button" title="模型" aria-label="模型" aria-haspopup="listbox" aria-expanded="false" aria-controls="select-popup">
							<i class="codicon codicon-symbol-method" aria-hidden="true"></i>
							<span id="model-select-value" class="select-value"></span>
						</button>
						<button id="thinking-select" class="select-control thinking-control" type="button" title="思考等级" aria-label="思考等级" aria-haspopup="listbox" aria-expanded="false" aria-controls="select-popup">
							<i class="codicon codicon-lightbulb" aria-hidden="true"></i>
							<span id="thinking-select-value" class="select-value"></span>
						</button>
					</div>
					<div class="composer-actions">
						<button id="send-button" class="send-button" type="submit" title="发送" aria-label="发送消息"><i class="codicon codicon-arrow-up"></i></button>
					</div>
				</div>
			</form>
		</footer>

		<div id="send-hint" class="send-hint" aria-hidden="true" hidden></div>
		<div id="toast-region" class="toast-region" role="status" aria-live="polite"></div>
		<div id="live-status" class="sr-only" role="status" aria-live="polite"></div>
		<div id="select-popup" class="popup-surface select-popup" role="listbox" hidden></div>
		<div id="session-menu" class="popup-surface session-menu" role="menu" aria-label="会话操作" hidden>
			<button id="clone-session-button" class="menu-item" type="button" role="menuitem" title="复制此会话"><i class="codicon codicon-files" aria-hidden="true"></i><span class="menu-item-label">复制此会话</span></button>
			<button id="fork-session-button" class="menu-item" type="button" role="menuitem" title="从较早的提示词分支" aria-haspopup="listbox" aria-controls="fork-panel" aria-expanded="false"><i class="codicon codicon-git-branch" aria-hidden="true"></i><span class="menu-item-label">从较早的提示词分支</span></button>
		</div>
		<div id="command-panel" class="command-panel" role="region" aria-label="斜杠命令" hidden>
			<div id="command-list" class="command-list" role="listbox" aria-label="斜杠命令"></div>
			<div class="command-search" role="search">
				<svg class="slash-icon is-search" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11 2.59L5 13.35" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
				<input id="command-search" type="search" placeholder="搜索命令…" aria-label="搜索命令" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="command-list">
			</div>
		</div>
		<div id="mention-panel" class="command-panel mention-panel" role="region" aria-label="工作区文件" hidden>
			<div id="mention-list" class="command-list mention-list" role="listbox" aria-label="工作区文件"></div>
		</div>
		<div id="usage-panel" class="usage-panel" role="dialog" aria-label="会话用量" hidden></div>
		<div id="modal-backdrop" class="modal-backdrop" hidden></div>
	</div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
