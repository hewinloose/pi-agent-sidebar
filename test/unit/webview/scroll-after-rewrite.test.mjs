/**
 * A history rewrite must not move the reader.
 *
 * Delete / edit / regenerate rebuild the conversation into a *new* pi session
 * file and switch pi onto it, so the next snapshot carries a different
 * `sessionId` while showing the same conversation minus some turns. The reader
 * was reading it at a position they chose; the rewrite is an edit of what they
 * are looking at, not navigation to a different conversation.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { loadBundledModule } from "../../helpers/load-bundled-module.mjs";

const message = (role, text, timestamp) => ({
	role,
	content: [{ type: "text", text }],
	timestamp,
});

/** A scroll container with the same bottom clamping as a real element. */
function fakeViewport({ scrollHeight, clientHeight }) {
	let height = scrollHeight;
	let top = scrollHeight - clientHeight;
	return {
		get scrollTop() {
			return top;
		},
		set scrollTop(value) {
			top = Math.max(0, Math.min(value, height - clientHeight));
		},
		get scrollHeight() {
			return height;
		},
		set scrollHeight(value) {
			height = value;
		},
		clientHeight,
	};
}

/** The real SessionController, TranscriptController and ScrollAnchor, wired as main.ts wires them. */
async function harness() {
	const transcriptModule = await loadBundledModule({ entry: "webview/transcript/controller.ts", platform: "browser" });
	const sessionModule = await loadBundledModule({ entry: "webview/session/controller.ts", platform: "browser" });
	const anchorModule = await loadBundledModule({ entry: "webview/transcript/scrollAnchor.ts", platform: "browser" });

	const viewport = fakeViewport({ scrollHeight: 4_000, clientHeight: 400 });
	const anchor = new anchorModule.module.ScrollAnchor({ viewport });
	const state = {
		state: {},
		messages: [],
		streamingIndex: 0,
		omittedMessageCount: 0,
		omittedPromptCount: 0,
		timeContext: { locale: "en" },
	};
	const children = [];
	const container = {
		insertBefore(node, reference) {
			const existing = children.indexOf(node);
			if (existing >= 0) children.splice(existing, 1);
			const index = reference === null ? children.length : children.indexOf(reference);
			children.splice(index < 0 ? children.length : index, 0, node);
		},
		removeChild(node) {
			const index = children.indexOf(node);
			if (index >= 0) children.splice(index, 1);
		},
	};
	const controller = new transcriptModule.module.TranscriptController({
		state,
		container,
		createNode: (entry) => ({ ...entry }),
		patchStreaming: () => undefined,
		scheduleRender() {},
		scheduleMeasure() {},
		// main.ts hands these two straight to the anchor.
		pinToBottom: () => anchor.stickToBottomIfFollowing(),
		syncJumpButton() {},
		followFresh: () => anchor.follow({ snap: true }),
		clearMediaRefusals() {},
		now: () => 1_000,
	});
	const session = new sessionModule.module.SessionController({
		state,
		transcript: controller,
		usage: { reset() {} },
		clearUnansweredSubmit() {},
		cancelFollow() {},
		clearExtensionUi() {},
		scheduleRender() {},
		announce() {},
		now: () => 1_000,
	});

	/** One host snapshot plus the render pass main.ts runs afterwards. */
	const apply = (snapshot) => {
		session.applySnapshot({
			type: "snapshot",
			messages: snapshot.messages,
			state: { sessionId: snapshot.sessionId, isStreaming: false },
			// The host marks the snapshot it emits after rebuilding the branch; a
			// switch the reader asked for arrives without it.
			historyRewritten: snapshot.historyRewritten,
			omittedMessageCount: 0,
			omittedPromptCount: 0,
			stats: {},
			models: [],
			thinkingLevels: ["off"],
			commands: [],
			workspaceName: "repo",
		});
		controller.render();
		anchor.stickToBottomIfFollowing();
	};

	return { apply, anchor, viewport, dispose: async () => {
		await transcriptModule.dispose();
		await sessionModule.dispose();
		await anchorModule.dispose();
	} };
}

test("deleting a turn leaves the reader where they were reading", async () => {
	const { apply, anchor, viewport, dispose } = await harness();
	try {
		const conversation = Array.from({ length: 30 }, (_, index) =>
			message(index % 2 === 0 ? "user" : "assistant", `turn ${index}`, index + 1),
		);
		apply({ sessionId: "session-1", messages: conversation });
		assert.equal(viewport.scrollTop, 3_600, "a snapshot lands at the latest message");

		// The reader wheels up into the middle of the conversation.
		viewport.scrollTop = 1_200;
		anchor.noteUserIntent(-120);
		anchor.noteScroll();
		assert.equal(anchor.isFollowing, false, "a wheel-up detaches the anchor");

		// Delete one turn: the host rewrites the branch into a new session file and
		// says so on the snapshot it emits, because the id changed but the
		// conversation did not.
		viewport.scrollHeight = 3_400;
		apply({
			sessionId: "session-2",
			messages: [...conversation.slice(0, 8), ...conversation.slice(12)],
			historyRewritten: true,
		});

		assert.equal(anchor.isFollowing, false, "a rewrite is not navigation to a new conversation");
		assert.equal(viewport.scrollTop, 1_200, "the reader stays on the turn they were reading");
	} finally {
		await dispose();
	}
});

test("opening another session still lands on its newest message", async () => {
	const { apply, anchor, viewport, dispose } = await harness();
	try {
		const first = Array.from({ length: 30 }, (_, index) =>
			message(index % 2 === 0 ? "user" : "assistant", `turn ${index}`, index + 1),
		);
		apply({ sessionId: "session-1", messages: first });
		viewport.scrollTop = 1_200;
		anchor.noteUserIntent(-120);
		anchor.noteScroll();
		assert.equal(anchor.isFollowing, false);

		// A session the reader picked from the list is a different conversation: no
		// rewrite marker, so the transcript starts at the latest message.
		apply({
			sessionId: "session-3",
			messages: [message("user", "elsewhere", 1), message("assistant", "other answer", 2)],
		});
		assert.equal(anchor.isFollowing, true);
		assert.equal(viewport.scrollTop, 3_600, "navigation still follows the newest message");
	} finally {
		await dispose();
	}
});
