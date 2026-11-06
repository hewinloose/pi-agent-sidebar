import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedCommands = [
	"piAgentSidebar.open",
	"piAgentSidebar.focusInput",
	"piAgentSidebar.newSession",
	"piAgentSidebar.newTrellisTask",
	"piAgentSidebar.restart",
	"piAgentSidebar.showLogs",
	"piAgentSidebar.renameSession",
	"piAgentSidebar.exportHtml",
	"piAgentSidebar.explainSelection",
	"piAgentSidebar.explainFile",
	"piAgentSidebar.refactorSelection",
	"piAgentSidebar.generateTests",
	"piAgentSidebar.explainDiagnostics",
	"piAgentSidebar.addFilesToInput",
];

test("manifest preserves public command IDs and selection keybindings", async () => {
	const manifest = JSON.parse(await readFile("package.json", "utf8"));
	assert.deepEqual(
		manifest.contributes.commands.map((command) => command.command),
		expectedCommands,
	);
	const keybinding = manifest.contributes.keybindings.find(
		(item) => item.command === "piAgentSidebar.focusInput",
	);
	assert.deepEqual(keybinding, {
		command: "piAgentSidebar.focusInput",
		key: "ctrl+escape",
		mac: "cmd+escape",
		when: "editorTextFocus",
	});
	assert.deepEqual(manifest.contributes.menus["explorer/context"], [
		{
			command: "piAgentSidebar.addFilesToInput",
			when: "resourceScheme == file || resourceScheme == vscode-remote",
			group: "navigation@100",
		},
	]);
	assert.deepEqual(manifest.contributes.menus.commandPalette, [
		{ command: "piAgentSidebar.addFilesToInput", when: "false" },
	]);
	assert.deepEqual(
		manifest.contributes.menus["piAgentSidebar.editorContext"][0],
		{
			command: "piAgentSidebar.focusInput",
			when: "editorHasSelection",
			group: "1_ask@0",
		},
	);
	// The editor title carries the plugin logo as a way back to the sidebar, the
	// way Claude Code's does. New session is not up there: it sits in the message
	// header beside the session history button, and the runtime phase is rendered
	// in that same header.
	assert.deepEqual(manifest.contributes.menus["editor/title"], [
		{ command: "piAgentSidebar.open", group: "navigation@1" },
	]);
	assert.equal(
		manifest.contributes.menus["view/title"],
		undefined,
		"the view title must not carry a command; the phase belongs to the header",
	);
	// The icon has to be the extension's own, not a codicon: the editor title
	// renders the command's declared icon, so the path is part of the contract.
	const open = manifest.contributes.commands.find(
		(command) => command.command === "piAgentSidebar.open",
	);
	assert.equal(open.icon, "assets/pi.svg");
	assert.ok(
		(await readFile("assets/pi.svg", "utf8")).includes("<svg"),
		"the editor-title icon must be a file that ships",
	);
	// Every clickable control is described in Chinese, the session buttons first.
	const document = await readFile("src/webviewDocument.ts", "utf8");
	const newSession = document.slice(document.indexOf('id="new-session-button"'));
	assert.ok(
		document.indexOf('id="history-button"') < document.indexOf('id="new-session-button"'),
		"new session sits to the right of session history",
	);
	assert.match(newSession, /title="新建会话"/u);
	for (const label of ["会话历史", "斜杠命令", "重命名会话", "发送消息", "会话用量详情"]) {
		assert.ok(document.includes(label), `missing Chinese label: ${label}`);
	}
});

test("the runtime phase is shown in the sidebar header, not a window status-bar item", async () => {
	const provider = await readFile("src/provider/piViewProvider.ts", "utf8");
	const extension = await readFile("src/extension.ts", "utf8");
	const header = await readFile("webview/ui/headerRenderer.ts", "utf8");
	// `createStatusBarItem(id, …)` only requires an id unique to the extension:
	// naming the item after the view did not scope it to the view title, so it sat
	// in the window status bar and reported a runtime nobody could open.
	assert.doesNotMatch(extension, /vscode\.window\.createStatusBarItem|StatusBarAlignment/u);
	assert.doesNotMatch(provider, /StatusBarItem|bindViewTitle|updateViewTitle/u);
	// The phase is still reported — by the header, which exists only while the
	// sidebar does. `connectionLabel` is what it renders the phase from.
	assert.match(header, /connectionLabel\(/u);
});

test("the pinned prompt rides a zero-height sticky rail", async () => {
	const html = await readFile("src/webviewDocument.ts", "utf8");
	// The rail must sit inside the scrolling transcript; anchoring it to #app
	// would need manual width/offset syncing on every sidebar resize.
	const transcript = html.slice(html.indexOf('id="transcript"'));
	const rail = transcript.indexOf('id="pinned-prompt-slot"');
	assert.ok(rail >= 0, "pinned prompt rail must live inside #transcript");
	assert.ok(
		rail < transcript.indexOf('id="messages"'),
		"the rail must precede #messages so it pins to the top edge",
	);
	for (const id of [
		"pinned-prompt",
		"pinned-prompt-body",
		"pinned-prompt-text",
		"pinned-prompt-toggle",
	]) {
		assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
	}

	const css = await readFile("webview/styles/transcript.css", "utf8");
	const slot = css.match(/\.pinned-prompt-slot\s*\{([^}]+)\}/u);
	assert.ok(slot, "missing .pinned-prompt-slot rule");
	assert.match(slot[1], /position:\s*sticky/iu);
	// Zero height is what keeps showing the row from displacing the messages
	// below it, which would read as a scroll jump.
	assert.match(slot[1], /height:\s*0/iu);

	const row = css.match(/\.pinned-prompt\s*\{([^}]+)\}/u);
	assert.ok(row, "missing .pinned-prompt rule");
	assert.match(row[1], /position:\s*absolute/iu);

	const expanded = css.match(
		/\.pinned-prompt\.is-expanded\s+\.pinned-prompt-text\s*\{([^}]+)\}/u,
	);
	assert.ok(expanded, "expanded pinned prompt must cap its own height");
	assert.match(expanded[1], /max-height/iu);
	assert.match(expanded[1], /overflow-y:\s*auto/iu);
});

test("inline composer tokens use font color without decoration", async () => {
	const css = await readFile("webview/styles/composer.css", "utf8");
	const match = css.match(
		/\.composer-reference-highlight,\s*\.composer-command-highlight\s*\{([^}]+)\}/u,
	);
	assert.ok(match, "shared composer token highlight rule is missing");
	const rule = match[1];
	assert.match(rule, /color:\s*var\(--vscode-textLink-foreground/iu);
	assert.match(rule, /background:\s*transparent/iu);
	assert.doesNotMatch(
		rule,
		/box-shadow|text-decoration|border(?:-radius)?\s*:/iu,
	);
});
