import assert from "node:assert/strict";
import test from "node:test";
import { loadBundledModule } from "../../helpers/load-bundled-module.mjs";

async function loadTranscript() {
	return loadBundledModule({
		entry: "webview/transcript/renderer.ts",
		name: "transcript",
		plugins: [
			{
				name: "mock-markdown",
				setup(buildApi) {
					buildApi.onResolve({ filter: /^dompurify$/ }, () => ({
						path: "dompurify",
						namespace: "mock-markdown",
					}));
					buildApi.onResolve({ filter: /^marked$/ }, () => ({
						path: "marked",
						namespace: "mock-markdown",
					}));
					buildApi.onLoad(
						{ filter: /^dompurify$/, namespace: "mock-markdown" },
						() => ({
							loader: "js",
							contents:
								"export default { sanitize: (value) => String(value) };",
						}),
					);
					buildApi.onLoad(
						{ filter: /^marked$/, namespace: "mock-markdown" },
						() => ({
							loader: "js",
							contents:
								"export const marked = { setOptions() {}, use(config) { globalThis.__transcriptMarkedRenderer = config.renderer; }, parse: (value) => `<p>${value}</p>` };",
						}),
					);
				},
			},
		],
	});
}

test("user transcript markers retain canonical URI and selection line", async () => {
	const loaded = await loadTranscript();
	try {
		const file = {
			path: "/workspace/src/file.ts",
			uri: "file:///workspace/src/file.ts",
			displayPath: "src/file.ts",
			marker: "@src/file.ts",
		};
		const directory = {
			path: "/workspace/src/provider",
			uri: "file:///workspace/src/provider",
			displayPath: "src/provider",
			marker: "@src/provider/",
		};
		const selection = {
			path: "/workspace/src/selected.ts",
			uri: "file:///workspace/src/selected.ts",
			displayPath: "src/selected.ts",
			marker: "@src/selected.ts#4",
			languageId: "typescript",
			startLine: 4,
			endLine: 4,
			text: "const selected = true;",
		};
		const content = [
			"<pi-context>",
			`- file: ${JSON.stringify(file)}`,
			`- directory: ${JSON.stringify(directory)}`,
			`- selection: ${JSON.stringify(selection)}`,
			"</pi-context>",
			"",
			"Compare @src/file.ts, @src/provider/, and @src/selected.ts#4",
		].join("\n");
		const html = loaded.module.messageHtml(
			{ role: "user", content },
			new Map(),
			new Map(),
			false,
			"message-0",
		);

		assert.match(
			html,
			/data-resource-uri="file:\/\/\/workspace\/src\/file\.ts"/u,
		);
		assert.match(
			html,
			/data-resource-uri="file:\/\/\/workspace\/src\/provider"[^>]*>@src\/provider\//u,
		);
		assert.match(
			html,
			/data-resource-uri="file:\/\/\/workspace\/src\/selected\.ts" data-workspace-line="4"/u,
		);
		assert.match(
			html,
			/Compare .*@src\/file\.ts.*, .*@src\/provider\/.*, and .*@src\/selected\.ts#4/u,
		);
	} finally {
		await loaded.dispose();
	}
});

test("assistant transcript preserves activity ordering and stream state", async () => {
	const loaded = await loadTranscript();
	try {
		const html = loaded.module.messageHtml(
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "checking" },
					{ type: "text", text: "answer" },
				],
				stopReason: "aborted",
				errorMessage: "partial failure",
			},
			new Map(),
			new Map(),
			true,
			"message-7",
			// Opened explicitly: this assertion is about the body reaching the page.
			() => true,
		);

		assert.match(html, /class="message assistant-message"/u);
		// An opened block keeps its body in the DOM, so a reasoning wall is parsed
		// once and the reader can follow it while it streams.
		assert.match(
			html,
			/thinking-block streaming is-expanded" data-thinking-key="message-7-thinking-0" data-expandable="thinking"/u,
		);
		assert.match(html, /checking/u);
		assert.match(html, /partial failure/u);
		assert.match(html, /Cancelled/u);

		// A block the reader closed keeps its body out of the DOM, so collapsing
		// a long reasoning wall never pays the parse.
		const collapsed = loaded.module.messageHtml(
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "checking" },
					{ type: "text", text: "answer" },
				],
				stopReason: "aborted",
				errorMessage: "partial failure",
			},
			new Map(),
			new Map(),
			true,
			"message-7",
			() => false,
		);
		assert.match(
			collapsed,
			/thinking-block streaming" data-thinking-key="message-7-thinking-0" data-expandable="thinking"/u,
		);
		assert.doesNotMatch(collapsed, /is-expanded|checking/u);
	} finally {
		await loaded.dispose();
	}
});

test("adjacent reasoning parts render as one section", async () => {
	const loaded = await loadTranscript();
	try {
		// The shape some models stream: one `thinking` block per reasoning part.
		const message = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "first part" },
				{ type: "thinking", thinking: "second part" },
				{ type: "text", text: "answer" },
			],
		};
		const collapsed = loaded.module.messageHtml(
			message,
			new Map(),
			new Map(),
			false,
			"message-9",
			() => false,
		);
		assert.equal(
			collapsed.match(/data-expandable="thinking"/gu).length,
			1,
			"two parts must not stack two collapsed rows",
		);
		assert.match(collapsed, /data-thinking-key="message-9-thinking-0"/u);
		assert.doesNotMatch(collapsed, /first part|second part/u);

		// One disclosure covers the whole run, and its parts keep their order.
		const expanded = loaded.module.messageHtml(
			message,
			new Map(),
			new Map(),
			false,
			"message-9",
			() => true,
		);
		assert.match(expanded, /aria-expanded="true"/u);
		assert.ok(expanded.indexOf("first part") < expanded.indexOf("second part"));
	} finally {
		await loaded.dispose();
	}
});

test("prose between reasoning parts keeps them apart", async () => {
	const loaded = await loadTranscript();
	try {
		const html = loaded.module.messageHtml(
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "first part" },
					{ type: "text", text: "prose" },
					{ type: "thinking", thinking: "second part" },
				],
			},
			new Map(),
			new Map(),
			false,
			"message-9",
		);
		assert.equal(html.match(/data-expandable="thinking"/gu).length, 2);
		assert.match(html, /data-thinking-key="message-9-thinking-1"/u);
	} finally {
		await loaded.dispose();
	}
});

test("live successful tool diff replaces persisted tool output", async () => {
	const loaded = await loadTranscript();
	try {
		const toolCall = {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "tool-1",
					name: "edit",
					arguments: { path: "src/file.ts" },
				},
			],
		};
		const results = new Map([
			[
				"tool-1",
				{
					role: "toolResult",
					toolCallId: "tool-1",
					content: [{ type: "text", text: "persisted output" }],
				},
			],
		]);
		const liveTools = new Map([
			[
				"tool-1",
				{
					id: "tool-1",
					name: "edit",
					args: { path: "src/file.ts" },
					status: "success",
					output: "live output",
					diff: "-old\n+new",
					startedAt: 0,
				},
			],
		]);
		const html = loaded.module.messageHtml(
			toolCall,
			results,
			liveTools,
			false,
			"message-1",
		);

		assert.match(html, /tool-call success/u);
		// pi labels the box with the raw tool name; the friendly name is reserved
		// for the screen-reader label, where "edit" alone reads as a verb.
		assert.match(html, /<span class="tool-name">edit<\/span>/u);
		// Colour is pi's only status channel. A visually-hidden note keeps the
		// state reachable by assistive tech; it rides in a span rather than an
		// aria-label because a label on a plain div has no role to attach to.
		assert.match(html, /<span class="sr-only">Edit file: done<\/span>/u);
		assert.match(html, /<span class="tool-path">src\/file\.ts<\/span>/u);
		assert.match(html, /data-tool-body="lazy"/u);
		// The collapsed row is one line, so the header text rides in its own span
		// and yields width to the output column beside it rather than clipping it
		// away (see the `.header-text` rules in transcript.css), and the box carries
		// the full text for the pointer that cannot read the clipped line. The trail
		// holds the hint alone, pinned to the row's right edge — the call's state
		// lives on the box's border, so the header carries no glyph of its own.
		assert.match(
			html,
			/<span class="header-text"><span class="tool-name">edit<\/span> <span class="tool-path">src\/file\.ts<\/span><\/span><span class="header-trail"><span class="tool-hint">output<\/span><\/span>/u,
		);
		assert.match(html, /title="edit src\/file\.ts"/u);
		assert.doesNotMatch(
			html,
			/diff-remove|diff-add|persisted output|live output/u,
			"collapsed tool cards must not materialize hidden output",
		);

		const body = loaded.module.toolBodyHtml(
			results.get("tool-1"),
			liveTools.get("tool-1"),
		);
		assert.match(body, /diff-remove/u);
		assert.match(body, /diff-add/u);
		assert.doesNotMatch(body, /persisted output|live output/u);

		const rawBody = loaded.module.toolBodyHtml(undefined, {
			...liveTools.get("tool-1"),
			output: undefined,
			diff: undefined,
			result: {
				content: [{ type: "text", text: "raw output" }],
				details: { diff: "-raw old\n+raw new" },
			},
		});
		assert.match(rawBody, /raw old/u);
		assert.match(rawBody, /raw new/u);
		assert.doesNotMatch(rawBody, /raw output/u);

		const unreadResult = {};
		Object.defineProperties(unreadResult, {
			content: {
				get() {
					throw new Error("collapsed rendering read tool content");
				},
			},
			details: {
				get() {
					throw new Error("collapsed rendering read tool details");
				},
			},
		});
		assert.doesNotThrow(() =>
			loaded.module.messageHtml(
				toolCall,
				new Map(),
				new Map([
					[
						"tool-1",
						{
							...liveTools.get("tool-1"),
							output: undefined,
							diff: undefined,
							result: unreadResult,
						},
					],
				]),
				true,
				"message-1",
			),
		);
	} finally {
		await loaded.dispose();
	}
});

test("a call with nothing to reveal still collapses onto one line", async () => {
	const loaded = await loadTranscript();
	try {
		const content = [
			{
				type: "toolCall",
				id: "tool-1",
				name: "bash",
				arguments: { command: 'npm run typecheck 2>&1 | grep -E "error TS"' },
			},
		];
		// No result: the call is still running, so it has no body to reveal and is
		// not a button. It clips anyway — a box that stayed wrapped until its first
		// output chunk landed snapped to one line mid-run — which leaves `title` as
		// the only way back to the full command, since there is no click to open.
		const html = loaded.module.messageHtml(
			{ role: "assistant", content },
			new Map(),
			new Map(),
			false,
			"message-1",
		);

		// The box itself carries no `expandable`: the only button in the markup is
		// the process handle that opens the run it belongs to.
		assert.doesNotMatch(html, /class="activity-item tool-call running expandable"/u);
		// The header carries no status glyph: the call's state lives on the box's
		// border, so a running box with no body is indistinguishable from a settled
		// one in the header itself (transcript.css breathes the border only while
		// the state class is on the box).
		assert.doesNotMatch(html, /tool-spinner/u);
		// The output column is in this header too, with no ink behind it: the word is
		// what fixes every tool box's clip at the same offset, so a box that will
		// never have output still reserves its width (transcript.css hides the ink of
		// a `:not(.expandable)` panel).
		assert.match(html, /<span class="tool-hint">output<\/span>/u);
		assert.match(
			html,
			/title="\$ npm run typecheck 2&gt;&amp;1 \| grep -E &quot;error TS&quot;"/u,
		);
		assert.match(
			html,
			/<span class="header-text">\$ npm run typecheck 2&gt;&amp;1 \| grep -E &quot;error TS&quot;<\/span>/u,
		);
	} finally {
		await loaded.dispose();
	}
});

test("a running call keeps the output column and no header glyph", async () => {
	const loaded = await loadTranscript();
	try {
		const toolCall = {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "tool-1",
					name: "bash",
					arguments: { command: "npm run build" },
				},
			],
		};
		// pi streams a partial result the moment a call starts, which gives a running
		// box a body to open — and so the hint. The hint's ink is held back while
		// the call runs (the breathing border is the status then), but the column
		// itself stays: the header text is clipped against it, so the settled row
		// has to measure the same as the running one for the hint to hold its place.
		const liveTools = new Map([
			[
				"tool-1",
				{
					id: "tool-1",
					name: "bash",
					args: { command: "npm run build" },
					status: "running",
					result: { content: [{ type: "text", text: "building…" }] },
					startedAt: 0,
					revision: 0,
				},
			],
		]);
		const html = loaded.module.messageHtml(
			toolCall,
			new Map(),
			liveTools,
			false,
			"message-1",
		);

		assert.match(html, /tool-call running expandable/u);
		assert.doesNotMatch(html, /tool-spinner/u);
		assert.match(
			html,
			/<span class="header-trail"><span class="tool-hint">output<\/span><\/span>/u,
		);
	} finally {
		await loaded.dispose();
	}
});

test("tool title preserves text beyond the one-line preview", async () => {
	const loaded = await loadTranscript();
	try {
		const command = `${"x".repeat(2100)} tail`;
		const html = loaded.module.messageHtml(
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "tool-long",
						name: "bash",
						arguments: { command },
					},
				],
			},
			new Map(),
			new Map(),
			false,
			"message-long-tool",
		);

		assert.ok(
			html.includes(`title="$ ${command}"`),
			"the tooltip should retain the command beyond the visible preview limit",
		);
		assert.ok(
			html.includes(`<span class="header-text">$ ${"x".repeat(1999)}…</span>`),
			"the rendered header should still use the bounded one-line preview",
		);
	} finally {
		await loaded.dispose();
	}
});

test("skill invocation renders as a collapsed card with the arguments below", async () => {
	const loaded = await loadTranscript();
	try {
		const content = [
			'<skill name="code-review" location="/skills/code-review/SKILL.md">',
			"References are relative to /skills/code-review.",
			"",
			"# Code Review Skill",
			"",
			"Review the diff carefully.",
			"</skill>",
			"",
			"please review my branch",
		].join("\n");
		const html = loaded.module.messageHtml(
			{ role: "user", content },
			new Map(),
			new Map(),
			false,
			"message-skill",
		);

		assert.match(
			html,
			/class="skill-block expandable" data-expandable="skill" data-skill-key="code-review"/u,
		);
		// Collapsed by default, like pi's SkillInvocationMessageComponent; the
		// file path has no room in the card so it rides in the title.
		assert.match(html, /aria-expanded="false"/u);
		assert.match(html, /title="\/skills\/code-review\/SKILL\.md"/u);
		assert.match(html, /<span class="skill-label">\[skill\]<\/span>/u);
		assert.match(html, /<span class="skill-name">code-review<\/span>/u);
		assert.match(html, /<span class="skill-hint">5 lines<\/span>/u);
		// Same one-line contract as a tool box: the label and name are what the
		// collapsed clip shortens, and the line count keeps its place at the end.
		assert.match(
			html,
			/<span class="header-text"><span class="skill-label">\[skill\]<\/span> <span class="skill-name">code-review<\/span><\/span><span class="header-trail"><span class="skill-hint">5 lines<\/span><\/span>/u,
		);
		// The body renders through the same sanitized markdown pipeline as any
		// other message content (the mocked marked wraps it in <p>).
		assert.match(html, /<div class="skill-body"><p>/u);
		// The typed arguments stay a separate user bubble, not raw text inside
		// the card.
		assert.match(
			html,
			/<article class="message user-message"><div class="user-message-text">please review my branch<\/div><\/article>/u,
		);
		// No arguments after </skill> means no empty bubble.
		const bare = loaded.module.messageHtml(
			{
				role: "user",
				content:
					'<skill name="code-review" location="/skills/code-review/SKILL.md">\nbody\n</skill>',
			},
			new Map(),
			new Map(),
			false,
			"message-skill-bare",
		);
		assert.match(bare, /skill-block/u);
		assert.doesNotMatch(bare, /user-message/u);
	} finally {
		await loaded.dispose();
	}
});

test("skill card escapes the payload and leaves plain user text alone", async () => {
	const loaded = await loadTranscript();
	try {
		const hostile = loaded.module.messageHtml(
			{
				role: "user",
				content:
					'<skill name="<img src=x onerror=alert(1)>" location="<script>">\nbody\n</skill>',
			},
			new Map(),
			new Map(),
			false,
			"message-skill-hostile",
		);
		assert.match(
			hostile,
			/data-skill-key="&lt;img src=x onerror=alert\(1\)&gt;"/u,
		);
		assert.match(hostile, /title="&lt;script&gt;"/u);
		assert.doesNotMatch(hostile, /<img src=x/u);

		// An unclosed tag is ordinary prose, not a skill invocation: it must
		// keep the plain user-message rendering.
		const partial = loaded.module.messageHtml(
			{ role: "user", content: '<skill name="broken">\nnever closed' },
			new Map(),
			new Map(),
			false,
			"message-skill-partial",
		);
		assert.doesNotMatch(partial, /skill-block/u);
		assert.match(partial, /class="message user-message"/u);
	} finally {
		await loaded.dispose();
	}
});

/**
 * The image renderer registered with marked, captured by the mock in
 * `loadTranscript` because the real marked never runs under Node.
 */
function imageRenderer() {
	return globalThis.__transcriptMarkedRenderer.image;
}

test("an image path becomes a placeholder the host resolves", async () => {
	const loaded = await loadTranscript();
	try {
		const image = imageRenderer();

		// No `src`: a path is not loadable from a webview, and a made-up `src` would
		// render as a broken image before the host ever answers.
		assert.equal(
			image({ href: "/tmp/preview.png", title: null, text: "preview" }),
			'<img class="message-media" data-media-source="/tmp/preview.png" alt="preview">',
		);
		assert.equal(
			image({ href: "docs/chart.png", title: null, text: "" }),
			'<img class="message-media" data-media-source="docs/chart.png" alt="">',
		);
		// The path is attacker-controlled text like any other: it lands in the DOM
		// escaped, so a hostile destination cannot add a tag or an attribute.
		assert.equal(
			image({
				href: 'x.png" onerror="alert(1)',
				title: 'a "quoted" title',
				text: "<shot>",
			}),
			'<img class="message-media" data-media-source="x.png&quot; onerror=&quot;alert(1)" alt="&lt;shot&gt;" title="a &quot;quoted&quot; title">',
		);
	} finally {
		await loaded.dispose();
	}
});

test("an image the webview can load keeps its src", async () => {
	const loaded = await loadTranscript();
	try {
		const image = imageRenderer();

		// Pasted and inline images rendered before this renderer existed, and still
		// must: only sources the webview cannot fetch take the host round trip.
		assert.equal(
			image({
				href: "data:image/png;base64,AAAA",
				title: null,
				text: "pasted",
			}),
			'<img class="message-media" src="data:image/png;base64,AAAA" alt="pasted">',
		);
		// A remote URL is not one of them: the CSP allows no third-party image host,
		// so it goes to the resolver and comes back as its alt text rather than as a
		// broken image box.
		assert.equal(
			image({ href: "https://example.com/a.png", title: null, text: "remote" }),
			'<img class="message-media" data-media-source="https://example.com/a.png" alt="remote">',
		);
	} finally {
		await loaded.dispose();
	}
});

test("a message image escapes its payload, not only its mime type", async () => {
	const loaded = await loadTranscript();
	try {
		const { messageHtml } = loaded.module;
		const withImage = (image) =>
			messageHtml(
				{ role: "user", content: [image], timestamp: 1 },
				new Map(),
				new Map(),
				false,
				"key-1",
			);

		// Real base64 must survive untouched: the escaping is for the markup's sake,
		// not a filter on the payload.
		const plain = withImage({
			type: "image",
			mimeType: "image/png",
			data: "AA+/=",
		});
		assert.match(plain, /src="data:image\/png;base64,AA\+\/="/u);

		// The data rides inside a double-quoted attribute, so a quote in it would end
		// the attribute early and let whatever follows become markup of its own. Every
		// character that can do that has to be escaped, mime type and payload alike.
		for (const hostile of [
			{ type: "image", mimeType: "image/png", data: 'AA" onerror="alert(1)' },
			{
				type: "image",
				mimeType: 'image/png" onerror="alert(1)',
				data: "AA+/=",
			},
		]) {
			const html = withImage(hostile);
			assert.ok(
				!html.includes('" onerror="'),
				`unescaped attribute break in ${html}`,
			);
			assert.ok(html.includes("&quot; onerror=&quot;"), html);
			// The src attribute ends where it should: the tag's own attributes still
			// follow, and the injected text stayed inside the value.
			const tag = /<img[^>]*>/u.exec(html)?.[0];
			assert.ok(tag, `no image element in ${html}`);
			assert.ok(tag.endsWith('alt="Attached image">'), tag);
		}
	} finally {
		await loaded.dispose();
	}
});

test("a row carries its history actions only when its prompt is addressable", async () => {
	const loaded = await loadTranscript();
	try {
		const user = { role: "user", content: [{ type: "text", text: "hello" }] };
		const withOrdinal = loaded.module.messageHtml(user, new Map(), new Map(), false, "message-0", undefined, 3);
		assert.match(withOrdinal, /data-message-action="edit"/u);
		assert.match(withOrdinal, /data-message-action="delete"/u);
		assert.match(withOrdinal, /data-prompt-ordinal="3"/u);
		assert.match(withOrdinal, /class="message-action danger"/u);
		// Under the bubble, not in it: PI-Desktop keeps the row outside the message
		// so a framed turn stays a turn, and lines it up with the reader's side.
		assert.ok(withOrdinal.indexOf("</article>") < withOrdinal.indexOf('class="message-actions'));
		assert.match(withOrdinal, /class="message-actions user-actions"/u);
		// The label is a tooltip, never the surface: PI-Desktop's zh-CN copy, and a
		// button body the DOM layer fills with the glyph after sanitizing.
		assert.match(withOrdinal, /title="编辑并重新发送"/u);
		assert.match(withOrdinal, /aria-label="编辑并重新发送"><\/button>/u);
		assert.match(withOrdinal, /aria-label="删除消息"><\/button>/u);
		assert.match(withOrdinal, /class="message-action danger"/u);

		// No ordinal means this row's prompt fell outside the window. Rendering the
		// buttons anyway would put a dead click on the row.
		const withoutOrdinal = loaded.module.messageHtml(user, new Map(), new Map(), false, "message-0");
		assert.equal(withoutOrdinal.includes("data-message-action"), false);

		const reply = { role: "assistant", content: [{ type: "text", text: "answer" }] };
		const replyHtml = loaded.module.messageHtml(reply, new Map(), new Map(), false, "message-1", undefined, 3);
		// PI-Desktop's order on a reply: read it, branch it, re-run it.
		assert.match(replyHtml, /data-message-action="copy"/u);
		assert.match(replyHtml, /data-message-action="fork"/u);
		assert.match(replyHtml, /data-message-action="regenerate"/u);
		assert.ok(
			replyHtml.indexOf('data-message-action="copy"') <
				replyHtml.indexOf('data-message-action="fork"') &&
				replyHtml.indexOf('data-message-action="fork"') <
					replyHtml.indexOf('data-message-action="regenerate"'),
		);
		// Copy names the message it belongs to instead of a prompt ordinal: the
		// answer lives with the message, and the row's own key is the cursor.
		assert.match(replyHtml, /data-message-action="copy" data-copy-key="message-1"/u);
		assert.match(replyHtml, /title="复制"/u);
		// Replies keep the row on their own left edge, and never on the reader's.
		assert.ok(replyHtml.indexOf("</article>") < replyHtml.indexOf('class="message-actions'));
		assert.equal(replyHtml.includes("user-actions"), false);
		assert.match(replyHtml, /title="重新生成"/u);
		assert.match(replyHtml, /title="从此回复创建分支"/u);
		// Neither reply action is destructive, so neither wears the danger class.
		assert.equal(replyHtml.includes("message-action danger"), false);
		// Copy is not a history action: a reply whose prompt fell out of the window
		// still copies, while the two actions that need the ordinal stay away.
		const orphan = loaded.module.messageHtml(reply, new Map(), new Map(), false, "message-9");
		assert.match(orphan, /data-message-action="copy"/u);
		assert.equal(orphan.includes("data-message-action=\"fork\""), false);
		assert.equal(orphan.includes("data-message-action=\"regenerate\""), false);
	} finally {
		await loaded.dispose();
	}
});

test("reasoning is hidden by default, command text included", async () => {
	const loaded = await loadTranscript();
	try {
		const command = "cd d:/code/pi-agent-sidebar && cat .trellis/.current-task";
		const message = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Check the task:\n\n```bash\n" + command + "\n```" },
				{ type: "text", text: "answer" },
			],
		};
		// No resolver is the real path: the controller answers "collapsed" unless the
		// reader opened this block, so nothing of the reasoning reaches the DOM — not
		// the prose, not the shell command it quoted.
		const hidden = loaded.module.messageHtml(message, new Map(), new Map(), false, "message-9");
		assert.equal(hidden.includes("current-task"), false);
		assert.equal(hidden.includes("Check the task"), false);
		assert.match(hidden, /aria-expanded="false"/u);
		assert.match(hidden, /thinking-collapsed/u);

		const opened = loaded.module.messageHtml(message, new Map(), new Map(), false, "message-9", () => true);
		assert.equal(opened.includes("current-task"), true);
	} finally {
		await loaded.dispose();
	}
});

test("a step that only ran a tool carries no reply actions", async () => {
	const loaded = await loadTranscript();
	try {
		const step = {
			role: "assistant",
			content: [
				{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "cd /repo && env | sort" } },
			],
		};
		// Regenerate and fork belong to an answer, never to the step that produced it:
		// hanging them under a shell command reads as if the command were the reply.
		const stepHtml = loaded.module.messageHtml(step, new Map(), new Map(), false, "message-4", undefined, 2);
		assert.equal(stepHtml.includes("data-message-action"), false);

		const answered = loaded.module.messageHtml(
			{
				role: "assistant",
				content: [
					{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } },
					{ type: "text", text: "done" },
				],
			},
			new Map(),
			new Map(),
			false,
			"message-5",
			undefined,
			2,
		);
		assert.match(answered, /data-message-action="regenerate"/u);
	} finally {
		await loaded.dispose();
	}
});

test("a closed bash box names the step instead of quoting the command", async () => {
	const loaded = await loadTranscript();
	try {
		const html = loaded.module.messageHtml(
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-9",
						name: "bash",
						arguments: { command: "env | grep -i '^PI_' | sort" },
					},
				],
			},
			new Map([["call-9", { role: "toolResult", toolCallId: "call-9", content: [{ type: "text", text: "PI_MODEL=…" }] }]]),
			new Map(),
			false,
			"message-8",
		);
		// The command stays in the DOM (the open state prints it, and `title` answers
		// a hover), but the closed row shows the label: a transcript that repeats
		// every pipeline the agent ran is unreadable.
		assert.match(html, /<span class="tool-command-name">运行命令<\/span>/u);
		assert.match(html, /data-tool-body="lazy"/u);
	} finally {
		await loaded.dispose();
	}
});

test("a message folds its whole activity into one process handle", async () => {
	const loaded = await loadTranscript();
	try {
		const html = loaded.module.messageHtml(
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "inspect" },
					{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "env | sort" } },
					{ type: "text", text: "done" },
					{ type: "toolCall", id: "call-2", name: "read", arguments: { path: "src/a.ts" } },
				],
			},
			new Map(),
			new Map(),
			false,
			"message-6",
		);
		// One handle for the message, not one per run: prose sitting between two tool
		// calls must not split the process in two.
		assert.equal((html.match(/<button type="button" class="activity-process"/gu) ?? []).length, 1);
		assert.equal((html.match(/data-process-head="true"/gu) ?? []).length, 1);
		// Labelled the way PI-Desktop labels its process group.
		assert.match(html, /<span class="activity-process-label">2 次工具操作<\/span>/u);
		assert.match(html, /<span class="activity-process-note">含思考<\/span>/u);
		assert.match(html, /data-glyph="sparkles"/u);
		assert.match(html, /data-glyph="chevron"/u);
		// Closed by default, so the slot itself carries no open state.
		assert.equal(html.includes("process-open"), false);
	} finally {
		await loaded.dispose();
	}
});
