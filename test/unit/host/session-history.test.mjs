import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadBundledModule } from "../../helpers/load-bundled-module.mjs";

/**
 * Fixtures are written as pi writes them: one JSON object per line, the header
 * first, every entry naming its parent. Building them by hand instead of reading
 * a captured file keeps the shape auditable — a change in what pi writes should
 * be a deliberate edit here.
 */
const header = { type: "session", version: 3, id: "session-1", cwd: "/repo", timestamp: "2026-01-01T00:00:00.000Z" };
const user = (id, parentId, text) => ({
	type: "message",
	id,
	parentId,
	timestamp: "2026-01-01T00:00:01.000Z",
	message: { role: "user", content: [{ type: "text", text }], timestamp: 1 },
});
const assistant = (id, parentId, text) => ({
	type: "message",
	id,
	parentId,
	timestamp: "2026-01-01T00:00:02.000Z",
	message: { role: "assistant", content: [{ type: "text", text }], timestamp: 2 },
});
const toolResult = (id, parentId, toolCallId) => ({
	type: "message",
	id,
	parentId,
	timestamp: "2026-01-01T00:00:03.000Z",
	message: { role: "toolResult", toolCallId, content: [{ type: "text", text: "out" }] },
});

const threeTurns = () => [
	user("u1", null, "first"),
	assistant("a1", "u1", "answer one"),
	toolResult("t1", "a1", "call-1"),
	user("u2", "t1", "second"),
	assistant("a2", "u2", "answer two"),
	user("u3", "a2", "third"),
	assistant("a3", "u3", "answer three"),
];

function documentFrom(lines) {
	return [JSON.stringify(header), ...lines.map((line) => JSON.stringify(line))].join("\n") + "\n";
}

async function loadHistory() {
	return loadBundledModule({
		entry: "src/services/sessionHistory.ts",
		name: "session-history",
	});
}

test("a session round-trips and exposes its prompts in order", async (t) => {
	const loaded = await loadHistory();
	t.after(loaded.dispose);
	const history = loaded.module;

	const document = history.readSessionDocument(documentFrom(threeTurns()));
	assert.equal(document.header.id, "session-1");
	assert.equal(document.entries.length, 7);
	assert.deepEqual(
		history.promptEntries(document).map((entry) => entry.id),
		["u1", "u2", "u3"],
	);
	// The leaf is the newest entry that nothing claims as a parent.
	assert.equal(history.activeLeafId(document), "a3");
});

test("deleting a prompt takes its turn and keeps the later ones", async (t) => {
	const loaded = await loadHistory();
	t.after(loaded.dispose);
	const history = loaded.module;

	const document = history.readSessionDocument(documentFrom(threeTurns()));
	const plan = history.planDeletePrompt(document, "u2");

	// u2, its reply and its tool result are gone; u1, u3 and their replies stay.
	assert.deepEqual(
		plan.entries.map((entry) => entry.id),
		["u1", "a1", "t1", "u3", "a3"],
	);
	// The surviving chain has no dangling parent: u3 now hangs off t1.
	const u3 = plan.entries.find((entry) => entry.id === "u3");
	assert.equal(u3.parentId, "t1");
	assert.equal(plan.entries.find((entry) => entry.id === "a3").parentId, "u3");
});

test("deleting the last prompt leaves the history before it intact", async (t) => {
	const loaded = await loadHistory();
	t.after(loaded.dispose);
	const history = loaded.module;

	const document = history.readSessionDocument(documentFrom(threeTurns()));
	const plan = history.planDeletePrompt(document, "u3");
	assert.deepEqual(
		plan.entries.map((entry) => entry.id),
		["u1", "a1", "t1", "u2", "a2"],
	);
});

test("truncating drops the prompt and everything after it", async (t) => {
	const loaded = await loadHistory();
	t.after(loaded.dispose);
	const history = loaded.module;

	const document = history.readSessionDocument(documentFrom(threeTurns()));
	const plan = history.planTruncateFromPrompt(document, "u2");
	assert.deepEqual(
		plan.entries.map((entry) => entry.id),
		["u1", "a1", "t1"],
	);
});

test("a rewrite lands on a new identity and the original stays untouched", async (t) => {
	const loaded = await loadHistory();
	t.after(loaded.dispose);
	const history = loaded.module;

	const document = history.readSessionDocument(documentFrom(threeTurns()));
	const plan = history.planDeletePrompt(document, "u2");
	const stamp = new Date("2026-02-02T10:20:30.000Z");
	const identified = history.withNewIdentity(plan, "/repo/sessions/original.jsonl", stamp);

	assert.equal(identified.header.id !== "session-1", true);
	// Recorded as an absolute path, which is how pi names a session file.
	assert.equal(identified.header.parentSession, path.resolve("/repo/sessions/original.jsonl"));
	assert.equal(identified.header.timestamp, stamp.toISOString());

	// The source document is untouched: entries are copies, not shared objects.
	assert.equal(document.entries.length, 7);
	assert.equal(document.byId.get("u2").parentId, "t1");

	const roundTripped = history.readSessionDocument(history.serializeSession(identified));
	assert.deepEqual(
		roundTripped.entries.map((entry) => entry.id),
		["u1", "a1", "t1", "u3", "a3"],
	);
});

test("the rewritten path stays beside the original", async (t) => {
	const loaded = await loadHistory();
	t.after(loaded.dispose);
	const history = loaded.module;
	const source = "/repo/sessions/original.jsonl";
	const target = history.rewrittenSessionPath(source, new Date("2026-02-02T10:20:30.500Z"));
	// The rewrite lands beside the original, inside pi's own session store, under
	// a stamp plus a fresh id — never on the file pi is holding.
	assert.equal(path.resolve(target).startsWith(path.resolve("/repo/sessions") + path.sep), true);
	assert.match(path.basename(target), /^2026-02-02T10-20-30-500Z_[0-9a-f-]{36}\.jsonl$/u);
	assert.notEqual(target, source);
});

test("a format it does not understand fails closed", async (t) => {
	const loaded = await loadHistory();
	t.after(loaded.dispose);
	const history = loaded.module;

	// A newer pi may change entry shapes; rewriting then would corrupt the tree.
	assert.throws(
		() => history.readSessionDocument(JSON.stringify({ ...header, version: 4 }) + "\n"),
		/format version 4/u,
	);
	assert.throws(() => history.readSessionDocument(""), /empty/u);
	assert.throws(() => history.readSessionDocument("not json\n"), /not valid JSON/u);
	assert.throws(
		() => history.readSessionDocument(JSON.stringify({ type: "other" }) + "\n"),
		/not a pi session/u,
	);
	// Two entries with one id would make parent lookups ambiguous.
	assert.throws(
		() => history.readSessionDocument(documentFrom([user("u1", null, "a"), user("u1", "u1", "b")])),
		/appears twice/u,
	);
	// A line with no type cannot be classified as a prompt or a reply.
	assert.throws(
		() => history.readSessionDocument(documentFrom([{ id: "u1", parentId: null }])),
		/has no type/u,
	);
});

test("only prompts on the branch can be rewritten", async (t) => {
	const loaded = await loadHistory();
	t.after(loaded.dispose);
	const history = loaded.module;

	const document = history.readSessionDocument(documentFrom(threeTurns()));
	// An assistant message is not a prompt.
	assert.throws(() => history.planDeletePrompt(document, "a1"), /Only a prompt/u);
	assert.throws(() => history.planTruncateFromPrompt(document, "a1"), /Only a prompt/u);
	// An id that is not on the active branch cannot be addressed at all.
	assert.throws(() => history.planDeletePrompt(document, "missing"), /active branch/u);
});

test("a plan that removes the last prompt holds no user turn", async (t) => {
	const loaded = await loadHistory();
	t.after(loaded.dispose);
	const history = loaded.module;

	const document = history.readSessionDocument(documentFrom(threeTurns()));
	// Truncating from the first prompt leaves the header and the pre-prompt
	// bookkeeping — a session pi refuses to open, so the host has to express the
	// empty result as a fresh session instead of writing this file.
	assert.equal(history.planHoldsUserTurn(history.planTruncateFromPrompt(document, "u1")), false);
	assert.equal(history.planHoldsUserTurn(history.planTruncateFromPrompt(document, "u2")), true);
	assert.equal(history.planHoldsUserTurn(history.planDeletePrompt(document, "u3")), true);
});
test("a rewrite is a chain pi can walk, not a cycle", async (t) => {
	const loaded = await loadHistory();
	t.after(loaded.dispose);
	const history = loaded.module;

	const document = history.readSessionDocument(documentFrom(threeTurns()));
	for (const [label, plan] of [
		["delete a middle turn", history.planDeletePrompt(document, "u2")],
		["delete the first turn", history.planDeletePrompt(document, "u1")],
		["truncate from a prompt", history.planTruncateFromPrompt(document, "u2")],
	]) {
		const written = history.serializeSession(history.withNewIdentity(plan, "/repo/sessions/original.jsonl"));
		const round = history.readSessionDocument(written);
		// Walking from the leaf has to terminate over the whole file. A cycle here is
		// exactly what made pi reject the rewritten session ("Invalid array length").
		const branch = history.activeBranch(round, history.activeLeafId(round));
		assert.equal(branch.length, round.entries.length, label);
		// The first entry keeps the parent it already had — its parent is still in
		// the file, so the prefix must not be re-pointed at the gap.
		assert.equal(round.entries[0].parentId, null, label);
	}
});
