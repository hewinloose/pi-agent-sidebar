import assert from "node:assert/strict";
import test from "node:test";
import { transcriptHarness } from "../../helpers/transcript-harness.mjs";

const message = (role, text, timestamp) => ({ role, content: [{ type: "text", text }], timestamp });
const thinkingBlock = (thinkingKey) => ({ dataset: { thinkingKey }, getBoundingClientRect: () => ({ top: 0 }) });

test("snapshot preserves buffered reply and session switch drops it and disclosures", async (t) => {
 const { controller, state, effects } = await transcriptHarness(t);
 const reply = message("assistant", "partial", 2);
 state.streamingMessage = controller.playback.start(reply);
 controller.setThinkingVisibility(thinkingBlock("old-thinking-0"), false);
 assert.equal(controller.isThinkingExpanded("old-thinking-0"), false);
 controller.adoptSnapshot([message("user", "question", 1)]);
 controller.reconcileSnapshot(false, true);
 assert.equal(controller.playback.isActive, true);
 assert.equal(state.streamingIndex, 1);
 controller.adoptSnapshot([message("user", "new session", 3)]);
 controller.reconcileSnapshot(true, false);
 assert.equal(state.streamingMessage, undefined);
 assert.equal(controller.playback.isActive, false);
 // The choice died with the session; the default (hidden) is back.
 assert.equal(controller.isThinkingExpanded("old-thinking-0"), false);
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

test("reasoning shows while the reply streams and folds once it settles", async (t) => {
 const { controller, state } = await transcriptHarness(t);
 const thinking = { type: "thinking", thinking: "weighing options" };
 const reply = { role: "assistant", content: [thinking, { type: "text", text: "answer" }], timestamp: 2 };
 // Nothing is live yet, so nothing is open.
 assert.equal(controller.isThinkingExpanded("message-9-thinking-0"), false);
 const streaming = controller.playback.start(reply);
 state.streamingIndex = 1;
 state.streamingMessage = streaming;
 const thinkingKey = `${controller.messageKey(streaming)}-thinking-0`;
 // While the answer is still being written, the reasoning is on screen.
 assert.equal(controller.isThinkingExpanded(thinkingKey), true);
 controller.settle(reply);
 // Identity is inherited, so the key survives the settle; the state does not.
 assert.equal(controller.isThinkingExpanded(thinkingKey), false);
});

test("a reader's toggle outranks the stream and survives the settle", async (t) => {
 const { controller, state } = await transcriptHarness(t);
 const thinking = { type: "thinking", thinking: "weighing options" };
 const reply = { role: "assistant", content: [thinking, { type: "text", text: "answer" }], timestamp: 2 };
 const streaming = controller.playback.start(reply);
 state.streamingIndex = 1;
 state.streamingMessage = streaming;
 const thinkingKey = `${controller.messageKey(streaming)}-thinking-0`;
 assert.equal(controller.isThinkingExpanded(thinkingKey), true);
 // The reader closes it mid-stream: that decision has to outlive the answer.
 controller.setThinkingVisibility(thinkingBlock(thinkingKey), false);
 assert.equal(controller.isThinkingExpanded(thinkingKey), false);
 controller.settle(reply);
 assert.equal(controller.isThinkingExpanded(thinkingKey), false);
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

test("reasoning visibility survives being handed to the renderer detached", async (t) => {
 const { controller } = await transcriptHarness(t);
 // The DOM layer reads this off the controller and passes it to the renderer, so
 // it has to keep its receiver. A prototype method throws when called this way,
 // and that throw aborts the frame that draws the transcript — every message in
 // it, not just the reasoning block.
 const { isThinkingExpanded } = controller;
 assert.equal(isThinkingExpanded("message-1-thinking-0"), false);
});
