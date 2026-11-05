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
	// header beside the session history button, so the view title holds only the
	// runtime phase badge.
	assert.deepEqual(manifest.contributes.menus["editor/title"], [
		{ command: "piAgentSidebar.open", group: "navigation@1" },
	]);
	assert.equal(
		manifest.contributes.menus["view/title"],
		undefined,
		"the view title must not carry a command; the phase badge is enough",
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

test("the view-title badge is shown, scoped to the view, and never starts as starting", async () => {
	const provider = await readFile("src/provider/piViewProvider.ts", "utf8");
	const extension = await readFile("src/extension.ts", "utf8");
	// Scoping is why the item exists: a window-level entry outlived the sidebar and
	// reported a runtime nobody was talking to.
	assert.match(extension, /createStatusBarItem\(\s*"piAgentSidebar\.chatView"/u);
	// A status bar item is hidden until shown. Without this call the badge never
	// appeared at all, and a type check cannot see that.
	assert.match(provider, /item\.show\(\)/u);
	// The phase starts neutral: activation must not claim a start that has not
	// happened, which is the "Pi starting forever" bug this replaced.
	assert.match(provider, /\| "idle"[\s\S]{0,200}= "idle";/u);
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
