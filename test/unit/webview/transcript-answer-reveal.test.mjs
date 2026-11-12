import assert from "node:assert/strict";
import test from "node:test";
import { transcriptHarness } from "../../helpers/transcript-harness.mjs";

const message = (role, text, timestamp, stopReason) => ({ role, content: [{ type: "text", text }], timestamp, stopReason });
const reveals = (effects) => effects.filter((effect) => Array.isArray(effect) && effect[0] === "reveal");
const finishRender = (controller) => { controller.render(); controller.revealSettledAnswer(); };

test("loading history and an unpaired completion never reveal an old answer", async (t) => {
 const { controller, state, effects } = await transcriptHarness(t);
 state.messages = [message("user", "old", 1), message("assistant", "old answer", 2, "stop")];
 controller.reconcileSnapshot(false, false);
 controller.noteAgentSettled();
 finishRender(controller);
 assert.equal(reveals(effects).length, 0);
});

test("only the final answer is revealed, after completion and DOM writes, once", async (t) => {
 const { controller, state, effects, children } = await transcriptHarness(t);
 state.messages = [message("user", "go", 1)];
 controller.noteAgentStart();
 for (let index = 0; index < 3; index += 1) {
  state.messages.push({ ...message("assistant", "working", 2 + index, "toolUse"), content: [
   { type: "text", text: "working" }, { type: "toolCall", id: `tool-${index}`, name: "bash", arguments: {} },
  ] });
  controller.renderStreamingFrame();
 }
 assert.equal(reveals(effects).length, 0, "tool steps are not completion");
 const answer = message("assistant", "final answer", 6, "stop");
 state.messages.push(answer);
 finishRender(controller);
 assert.equal(reveals(effects).length, 0, "a message end alone is not run completion");
 controller.noteAgentSettled();
 controller.renderStreamingFrame();
 const revealed = reveals(effects);
 assert.equal(revealed.length, 1);
 assert.equal(revealed[0][1], children.find((node) => node.message === answer), "the rendered answer owns the target");
 assert.equal(revealed[0][1].turnProcess.open, false, "the process is folded before revealing");
 assert.equal(revealed[0][1].isAnswer, true);
 assert.ok(effects.indexOf(revealed[0]) < effects.lastIndexOf("pin"), "reveal can detach before the final pin");
 controller.noteAgentSettled();
 finishRender(controller);
 controller.renderStreamingFrame();
 assert.equal(reveals(effects).length, 1, "repeated completion and renders are harmless");
});

test("completion waits for the final playback frame, including queued follow-up prompts", async (t) => {
 const { controller, state, effects } = await transcriptHarness(t);
 state.messages = [message("user", "go", 1)];
 controller.noteAgentStart();
 const answer = message("assistant", "buffered answer ".repeat(400), 2, "stop");
 state.streamingIndex = 1;
 state.streamingMessage = controller.playback.start(answer);
 controller.playback.finish(answer);
 // A follow-up echo can arrive before playback has inserted this reply.
 state.messages.push(message("user", "next question", 3));
 controller.noteAgentSettled();
 finishRender(controller);
 assert.equal(reveals(effects).length, 0);
 let frames = 0;
 while (controller.playback.needsFrame && frames < 1000) {
  controller.advance(++frames * 16);
  controller.renderStreamingFrame();
  if (controller.playback.isActive) assert.equal(reveals(effects).length, 0);
 }
 assert.ok(frames > 1 && frames < 1000, "the real buffer drains over multiple frames");
 assert.deepEqual(state.messages.map((value) => value.timestamp), [1, 2, 3]);
 assert.equal(reveals(effects).length, 1);
 assert.equal(reveals(effects)[0][1].message.content[0].text, answer.content[0].text);
 assert.equal(reveals(effects)[0][1].promptOrdinal, 0, "reveal belongs to the answered prompt");
});

for (const snapshotFirst of [false, true]) {
 test(`completion reveals once across authoritative snapshots (snapshot first: ${snapshotFirst})`, async (t) => {
  const { controller, state, effects } = await transcriptHarness(t);
  const prompt = message("user", "go", 1);
  const answer = message("assistant", "answer", 2, "stop");
  state.messages = [prompt];
  controller.noteAgentStart();
  state.streamingIndex = 1;
  state.streamingMessage = controller.playback.start(answer);
  controller.playback.finish(answer);
  if (!snapshotFirst) controller.noteAgentSettled();
  controller.adoptSnapshot([structuredClone(prompt), structuredClone(answer)]);
  controller.reconcileSnapshot(false, false);
  if (snapshotFirst) {
   finishRender(controller);
   assert.equal(reveals(effects).length, 0);
   controller.noteAgentSettled();
  }
  finishRender(controller);
  assert.equal(reveals(effects).length, 1);
  controller.adoptSnapshot([structuredClone(prompt), structuredClone(answer)]);
  controller.reconcileSnapshot(false, false);
  controller.noteAgentSettled();
  finishRender(controller);
  assert.equal(reveals(effects).length, 1, "the refresh does not arm another reveal");
 });
}

for (const kind of ["toolUse", "thinking", "aborted", "error", "empty"]) {
 test(`a ${kind} ending cannot reveal an old answer`, async (t) => {
  const { controller, state, effects } = await transcriptHarness(t);
  state.messages = [message("user", "old", 1), message("assistant", "old answer", 2, "stop")];
  controller.noteAgentStart();
  state.messages.push(message("user", "next", 3));
  const last = message("assistant", "partial", 4, kind);
  if (kind === "thinking") last.content = [{ type: "thinking", thinking: "no answer" }];
  if (kind === "empty") last.content = [];
  state.messages.push(last);
  controller.noteAgentSettled();
  finishRender(controller);
  assert.equal(reveals(effects).length, 0);
 });
}

test("a tool-only run cannot reveal history beyond the snapshot identity window", async (t) => {
 const { controller, state, effects, children } = await transcriptHarness(t);
 state.messages = [message("user", "old", 1), message("assistant", "old answer", 2, "stop"), message("user", "next", 3)];
 controller.render();
 const oldAnswerKey = controller.messageKey(state.messages[1]);
 controller.noteAgentStart();
 for (let index = 0; index < 101; index += 1) {
  state.messages.push({ ...message("assistant", "working", 4 + index * 3, "toolUse"), content: [
   { type: "toolCall", id: `first-${index}`, name: "bash", arguments: {} },
   { type: "toolCall", id: `second-${index}`, name: "bash", arguments: {} },
  ] }, { role: "toolResult", toolCallId: `first-${index}`, content: "done" },
  { role: "toolResult", toolCallId: `second-${index}`, content: "done" });
 }
 const final = { ...message("assistant", "", 400, "stop"), content: [{ type: "thinking", thinking: "no answer" }] };
 state.streamingIndex = state.messages.length;
 state.streamingMessage = controller.playback.start(final);
 controller.playback.finish(final);
 controller.noteAgentSettled();
 controller.adoptSnapshot(structuredClone([...state.messages, final]));
 controller.reconcileSnapshot(false, false);
 assert.notEqual(controller.messageKey(state.messages[1]), oldAnswerKey, "the old answer is outside identity adoption's bounded tail");
 finishRender(controller);
 assert.ok(children.some((node) => node.isAnswer && node.message.content[0]?.text === "old answer"), "the old answer is still rendered");
 assert.equal(reveals(effects).length, 0);
});

for (const cancel of ["session switch", "disconnect"]) {
 test(`${cancel} cancels a pending answer reveal`, async (t) => {
  const { controller, state, effects } = await transcriptHarness(t);
  state.messages = [message("user", "go", 1)];
  controller.noteAgentStart();
  state.messages.push(message("assistant", "answer", 2, "stop"));
  controller.noteAgentSettled();
  if (cancel === "session switch") {
   controller.adoptSnapshot([message("user", "other", 3), message("assistant", "other answer", 4, "stop")]);
   controller.reconcileSnapshot(true, false);
  } else controller.interrupt("Disconnected");
  finishRender(controller);
  controller.noteAgentSettled();
  finishRender(controller);
  assert.equal(reveals(effects).length, 0);
 });
}

test("a new run supersedes a pending reveal and can reveal its own answer", async (t) => {
 const { controller, state, effects } = await transcriptHarness(t);
 state.messages = [message("user", "first", 1)];
 controller.noteAgentStart();
 state.messages.push(message("assistant", "first answer", 2, "stop"));
 controller.noteAgentSettled();
 controller.noteAgentStart();
 finishRender(controller);
 assert.equal(reveals(effects).length, 0);
 const answer = message("assistant", "second answer", 4, "stop");
 state.messages.push(message("user", "second", 3), answer);
 controller.noteAgentSettled();
 finishRender(controller);
 assert.equal(reveals(effects).length, 1);
 assert.equal(reveals(effects)[0][1].message, answer);
});

for (const transition of ["new run", "session switch", "disconnect"]) {
 test(`${transition} cancels an answer animation after its reveal was consumed`, async (t) => {
  const { controller, state, effects } = await transcriptHarness(t);
  state.messages = [message("user", "go", 1)];
  controller.noteAgentStart();
  state.messages.push(message("assistant", "answer", 2, "stop"));
  controller.noteAgentSettled();
  finishRender(controller);
  assert.equal(reveals(effects).length, 1);
  effects.length = 0;
  controller.adoptSnapshot(structuredClone(state.messages));
  controller.reconcileSnapshot(false, false);
  assert.equal(effects.includes("cancel-reveal"), false, "same-session refresh keeps the trip alive");
  if (transition === "new run") controller.noteAgentStart();
  else if (transition === "session switch") controller.reconcileSnapshot(true, false);
  else controller.interrupt("Disconnected");
  assert.ok(effects.includes("cancel-reveal"));
 });
}
