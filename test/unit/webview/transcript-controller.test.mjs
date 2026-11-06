import assert from "node:assert/strict";
import test from "node:test";
import { transcriptHarness } from "../../helpers/transcript-harness.mjs";

const message = (role, text, timestamp) => ({ role, content: [{ type: "text", text }], timestamp });

test("snapshot preserves a buffered reply and a session switch drops it", async (t) => {
 const { controller, state, effects } = await transcriptHarness(t);
 const reply = message("assistant", "partial", 2);
 state.streamingMessage = controller.playback.start(reply);
 controller.adoptSnapshot([message("user", "question", 1)]);
 controller.reconcileSnapshot(false, true);
 assert.equal(controller.playback.isActive, true);
 assert.equal(state.streamingIndex, 1);
 controller.adoptSnapshot([message("user", "new session", 3)]);
 controller.reconcileSnapshot(true, false);
 assert.equal(state.streamingMessage, undefined);
 assert.equal(controller.playback.isActive, false);
 assert.ok(effects.includes("media"));
 assert.ok(effects.includes("follow"));
});

test("a final reply listed in snapshot is not duplicated", async (t) => {
 const { controller, state } = await transcriptHarness(t);
 const reply = message("assistant", "answer", 2);
 state.streamingMessage = controller.playback.start(reply);
 controller.playback.finish(reply);
 controller.adoptSnapshot([message("user", "question", 1), { ...reply }]);
 controller.reconcileSnapshot(false, false);
 assert.equal(state.messages.length, 2);
 assert.equal(state.streamingMessage, undefined);
});

test("interrupt keeps reply ahead of follow-up and marks only running tools failed", async (t) => {
 const { controller, state } = await transcriptHarness(t);
 state.messages = [message("user", "question", 1), message("user", "follow-up", 3)];
 state.streamingIndex = 1;
 state.streamingMessage = controller.playback.start(message("assistant", "answer", 2));
 controller.liveTools.set("running", { status: "running", revision: 0 });
 controller.liveTools.set("done", { status: "success", revision: 1 });
 controller.interrupt("Disconnected");
 assert.deepEqual(state.messages.map((value) => value.timestamp), [1, 2, 3]);
 assert.equal(state.messages[1].stopReason, "aborted");
 assert.equal(controller.liveTools.get("running").status, "error");
 assert.equal(controller.liveTools.get("running").result.content[0].text, "Disconnected");
 assert.equal(controller.liveTools.get("done").status, "success");
});

test("progressive transcript keeps omitted count stable and hides empty streaming shell", async (t) => {
 const { controller, state, children } = await transcriptHarness(t);
 state.messages = Array.from({ length: 160 }, (_, index) => message("user", String(index), index + 1));
 state.omittedMessageCount = 20;
 state.streamingMessage = { role: "assistant", content: [] };
 controller.render();
 assert.equal(children.find((node) => node.key === "history-omitted").omitted, 30);
 assert.equal(children.filter((node) => node.message).length, 40);
 for (let index = 0; index < 4; index++) controller.render();
 assert.equal(children.filter((node) => node.message).length, 150);
 assert.equal(children.some((node) => node.message?.role === "assistant"), false);
});

test("a turn folds every step into one handle and a settled turn starts closed", async (t) => {
 const { controller, state, children } = await transcriptHarness(t);
 const stepOne = {
  role: "assistant",
  content: [
   { type: "thinking", thinking: "weighing" },
   { type: "toolCall", id: "a", name: "bash", arguments: { command: "ls" } },
  ],
  timestamp: 2,
 };
 const stepTwo = {
  role: "assistant",
  content: [{ type: "toolCall", id: "b", name: "read", arguments: { path: "x" } }],
  timestamp: 3,
 };
 state.messages = [message("user", "go", 1), stepOne, stepTwo];
 controller.render();
 const rows = children.filter((node) => node.message?.role === "assistant").map((node) => node.turnProcess);
 // One handle for the turn, on its first step: the second step must not carry one.
 assert.deepEqual(rows.map((row) => row.isHead), [true, false]);
 assert.equal(rows[0].turnId, rows[1].turnId);
 // Counts cover the whole turn, from its first step to its last.
 assert.equal(rows[0].label, "2 次工具操作");
 assert.equal(rows[0].note, "含思考");
 // Settled: closed until the reader says otherwise.
 assert.equal(rows[0].open, false);
});

test("a live turn starts open and the reader's choice outranks the settle", async (t) => {
 const { controller, state, children } = await transcriptHarness(t);
 const reply = {
  role: "assistant",
  content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "answer" }],
  timestamp: 2,
 };
 state.streamingIndex = 1;
 state.streamingMessage = reply;
 state.messages = [message("user", "go", 1)];
 controller.render();
 const live = children.find((node) => node.message?.role === "assistant").turnProcess;
 // A turn still being written is open, so the reader can watch the work.
 assert.equal(live.open, true);
 controller.setTurnProcess(live.turnId, false);
 controller.settle(reply);
 controller.render();
 const settled = children.filter((node) => node.message?.role === "assistant").at(-1).turnProcess;
 // The reader closed it mid-stream, so the settle must not reopen it.
 assert.equal(settled.open, false);
});

test("a new session drops the turn choices", async (t) => {
 const { controller, state, children } = await transcriptHarness(t);
 const reply = { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }], timestamp: 2 };
 state.messages = [message("user", "go", 1), reply];
 controller.render();
 const first = children.find((node) => node.message?.role === "assistant").turnProcess;
 controller.setTurnProcess(first.turnId, true);
 controller.render();
 assert.equal(controller.turnProcessFor(controller.messageKey(reply)).open, true);
 state.messages = [
  message("user", "other", 3),
  { role: "assistant", content: [{ type: "thinking", thinking: "other" }], timestamp: 4 },
 ];
 controller.reconcileSnapshot(true, false);
 controller.render();
 const next = children.filter((node) => node.message?.role === "assistant").at(-1).turnProcess;
 // The choice died with the session: a settled turn is closed again.
 assert.equal(next.open, false);
});

test("history actions address prompts from the start of the session, not from the window", async (t) => {
 const { controller, state, children } = await transcriptHarness(t);
 // Two prompts were dropped ahead of the window, so the first row here is the
 // third prompt of the session and the ordinal it carries has to say so.
 state.omittedPromptCount = 2;
 state.messages = [
  message("user", "third prompt", 1),
  message("assistant", "reply three", 2),
  message("user", "fourth prompt", 3),
  message("assistant", "reply four", 4),
 ];
 controller.render();
 const ordinals = children
  .filter((node) => node.message)
  .map((node) => [node.message.timestamp, node.promptOrdinal]);
 // A reply belongs to the prompt that opened its turn: deleting from the reply's
 // own row still has to remove the right turn.
 assert.deepEqual(ordinals, [
  [1, 2],
  [2, 2],
  [3, 3],
  [4, 3],
 ]);
});

test("a reply's copy cursor resolves to pi's own answer text", async (t) => {
 const { controller, state } = await transcriptHarness(t);
 const reply = {
  role: "assistant",
  content: [{ type: "text", text: "first line" }, { type: "text", text: "second line" }],
 };
 state.messages = [message("user", "question", 1), reply];
 // pi sends one block per paragraph, and the clipboard keeps that line structure
 // instead of gluing two paragraphs into one.
 assert.equal(controller.copyTextFor(controller.messageKey(reply)), "first line\nsecond line");
 // A row the snapshot no longer holds copies nothing; the caller toasts instead
 // of writing "undefined" to the clipboard.
 assert.equal(controller.copyTextFor("message-does-not-exist"), undefined);
 // Reasoning is not an answer: a step carries no copyable prose.
 const step = { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] };
 state.messages = [message("user", "question", 1), step];
 assert.equal(controller.copyTextFor(controller.messageKey(step)), undefined);
});
