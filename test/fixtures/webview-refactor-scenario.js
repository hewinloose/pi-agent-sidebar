(() => {
 const sent = [];
 const errors = [];
 // Chrome's virtual-time dump does not reliably produce compositor frames.
 // Keep the real FrameCoordinator, but drive its browser clock with timers.
 window.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 16);
 window.cancelAnimationFrame = (handle) => clearTimeout(handle);
 window.addEventListener("error", (event) => { errors.push(event.message); document.body.dataset.testError = event.message; });
 window.addEventListener("unhandledrejection", (event) => { document.body.dataset.testError = String(event.reason); });
 window.acquireVsCodeApi = () => ({
  postMessage(message) { sent.push(message); if (message.type === "ready") setTimeout(() => void scenario(), 10); },
  getState: () => undefined, setState() {},
 });
 const get = (id) => document.getElementById(id);
 const wait = () => new Promise((resolve) => setTimeout(resolve, 150));
 const check = (condition, message) => { if (!condition) throw new Error(message); };
 const post = async (data) => { window.dispatchEvent(new MessageEvent("message", { data, source: null })); await wait(); };
 const rpc = (event) => post({ type: "rpcEvent", event });
 const waitFor = async (condition, message) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
   if (condition()) return;
   await new Promise((resolve) => setTimeout(resolve, 20));
  }
  check(false, message);
 };
 const prompt = { role: "user", timestamp: 1000, content: [{ type: "text", text: "first question" }] };
 const snapshot = (id, messages = [prompt]) => ({ type: "snapshot", state: { sessionId: id }, messages, models: [], thinkingLevels: ["off"], commands: [], workspaceName: "workspace", stats: { cost: 0.1, contextUsage: { tokens: null, percent: null, contextWindow: 200000 } } });
 async function scenario() {
  try {
   check(sent.filter((item) => item.type === "ready").length === 1, "ready handshake exactly once");
   await post({ type: "bootstrap", phase: "starting", workspaceName: "workspace" });
   await post(snapshot("one"));
   await post({ type: "connection", phase: "ready" });
   check(!get("prompt-input").disabled, "composer enabled after ready");
   check(get("messages").textContent.includes("first question"), "snapshot rendered");
   const original = get("messages").querySelector(".user-message");
   await post(snapshot("one", [JSON.parse(JSON.stringify(prompt))]));
   check(get("messages").querySelector(".user-message") === original, "unchanged snapshot preserves DOM identity");
   get("runtime-meta").click();
   check(get("usage-panel").textContent.includes("下次回复后可用"), "null context remains unavailable");
   get("runtime-meta").click();
   await rpc({ type: "extension_ui_request", method: "setWidget", widgetKey: "test", widgetLines: ["\u001b[31mred\u001b[0m"] });
   check(get("widget-area").textContent === "red", "widget ANSI cleanup");
   await post({ type: "setComposerText", text: "draft" });
   get("new-session-button").click();
   const action = sent.findLast((item) => item.type === "newSession");
   check(action?.actionId, "new session action retains ID");
   await post({ type: "actionResult", actionId: action.actionId, ok: true, cancelled: true });
   check(get("prompt-input").value === "draft", "cancelled action preserves draft");
   get("history-button").click();
   await post({ type: "sessionList", sessions: [{ title: "Earlier", excerpt: "example", path: "/opaque/session", active: false, createdAt: 1000 }] });
   get("session-list").querySelector(".session-open").click();
   check(sent.some((item) => item.type === "switchSession" && item.path === "/opaque/session"), "session path forwarded");
   get("fork-session-button").click();
   await post({ type: "forkCandidates", candidates: [{ entryId: "opaque-entry", text: "first question", timestamp: 1000 }] });
   get("fork-search").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
   check(!sent.some((item) => item.type === "forkSession"), "fork has no implicit default");
   get("fork-search").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
   get("fork-search").value = "no match";
   get("fork-search").dispatchEvent(new Event("input"));
   get("fork-search").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
   check(!sent.some((item) => item.type === "forkSession"), "filter cannot submit an invisible fork row");
   get("fork-search").value = "";
   get("fork-search").dispatchEvent(new Event("input"));
   get("fork-search").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
   get("fork-search").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
   check(sent.some((item) => item.type === "forkSession" && item.entryId === "opaque-entry"), "fork entry forwarded");
   await post({ type: "forkCandidates", candidates: [{ entryId: "late", text: "late reply" }] });
   check(get("fork-panel").hidden && get("fork-list").children.length === 0, "late fork reply stays hidden");
   await post({ type: "setComposerText", text: "" });
   await rpc({ type: "agent_start" });
   const reply = { role: "assistant", timestamp: 2000, content: [{ type: "thinking", thinking: "reasoning text" }, { type: "text", text: "streamed answer" }, { type: "toolCall", id: "tool-id", name: "bash", arguments: { command: "echo ok" } }] };
   await rpc({ type: "message_start", message: { ...reply, content: [] } });
   await rpc({ type: "message_update", message: reply });
   await rpc({ type: "message_end", message: reply });
   await rpc({ type: "agent_settled" });
   await wait();
   check(get("messages").textContent.includes("streamed answer"), "streaming settles visibly");
   await rpc({ type: "tool_execution_start", toolCallId: "tool-id", toolName: "bash", args: { command: "echo ok" } });
   await rpc({ type: "tool_execution_update", toolCallId: "tool-id", partialResult: { content: [{ type: "text", text: "first output" }] } });
   const tool = get("messages").querySelector('.tool-call[data-tool-key="tool-id"]');
   check(tool, "tool card rendered");
   tool.click();
   await rpc({ type: "tool_execution_update", toolCallId: "tool-id", partialResult: { content: [{ type: "text", text: "updated output" }] } });
   check(tool.classList.contains("expanded") && tool.textContent.includes("updated output"), "expanded tool refreshes in place");
   const process = get("messages").querySelector(".activity-process");
   check(process, "turn process handle rendered");
   process.click();
   await wait();
   check(process.closest(".message-slot").dataset.turnOpen === "true", "turn process expands through controller state");
   check(get("messages").querySelector(".thinking-text").getBoundingClientRect().height > 0, "reasoning is visible inside the open process");
   await post(snapshot("two", [{ role: "user", content: "new session question", timestamp: 3000 }]));
   check(!get("messages").textContent.includes("streamed answer"), "session switch clears old reply");
   check(get("widget-area").hidden, "session switch clears widgets");
   const longHistory = Array.from({ length: 80 }, (_, index) => ({ role: "user", content: `history message ${index}`, timestamp: 4000 + index }));
   await post(snapshot("three", longHistory));
   await wait();
   const viewport = get("transcript");
   viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
   viewport.scrollTop = 0;
   viewport.dispatchEvent(new Event("scroll"));
   await wait();
   check(get("jump-to-bottom").classList.contains("is-visible"), "reader scroll detaches from bottom");
   get("jump-to-bottom").click();
   await wait();
   check(!get("jump-to-bottom").classList.contains("is-visible"), "jump reattaches bottom following");
   const revealPrompt = { role: "user", content: "show a long final answer", timestamp: 5000 };
   const step = { role: "assistant", timestamp: 6000, stopReason: "toolUse", content: [
    { type: "text", text: "Preparing the answer" },
    { type: "toolCall", id: "reveal-tool", name: "bash", arguments: { command: "echo ready" } },
   ] };
   const answerText = "Answer starts here.\n\n" + Array.from({ length: 36 }, (_, index) => `Paragraph ${index}: a long answer keeps its beginning available for reading after the final text has appeared.`).join("\n\n");
   const answer = { role: "assistant", timestamp: 7000, stopReason: "stop", content: [
    { type: "thinking", thinking: "Check the results before answering." }, { type: "text", text: answerText },
   ] };
   await post(snapshot("answer-reveal", [...longHistory, revealPrompt]));
   get("prompt-input").focus();
   window.dispatchEvent(new Event("focus"));
   const focusedBeforeAnswer = document.activeElement;
   await rpc({ type: "agent_start" });
   await rpc({ type: "message_start", message: { ...step, content: [] } });
   await rpc({ type: "message_end", message: step });
   await rpc({ type: "message_start", message: { ...answer, content: [] } });
   await rpc({ type: "message_end", message: answer });
   window.dispatchEvent(new Event("blur"));
   await rpc({ type: "agent_settled" });
   await waitFor(() => [...get("messages").querySelectorAll(".assistant-message")].at(-1)?.closest(".message-slot")?.querySelector("[data-copy-key]"), "buffered final answer finishes in the background");
   const answerNode = [...get("messages").querySelectorAll(".assistant-message")].at(-1);
   const answerBody = answerNode.querySelector(".assistant-text");
   const backgroundTop = viewport.scrollTop;
   await new Promise((resolve) => setTimeout(resolve, 750));
   check(Math.abs(viewport.scrollTop - backgroundTop) <= 1, "background completion waits for focus");
   check(Math.abs(answerBody.getBoundingClientRect().top - get("pinned-prompt").getBoundingClientRect().bottom - 8) > 20, "background reveal is still pending");
   await post(snapshot("answer-reveal", [...longHistory, revealPrompt, step, answer]));
   viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
   window.dispatchEvent(new Event("focus"));
   check(Math.abs(viewport.scrollTop - backgroundTop) <= 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches, "focus resumes without teleporting");
   if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const movingPositions = new Set();
    await waitFor(() => {
     movingPositions.add(Math.round(viewport.scrollTop));
     return movingPositions.size >= 3;
    }, "focus resumes the pending smooth reveal after a normal click");
    window.dispatchEvent(new Event("blur"));
    const pausedTop = viewport.scrollTop;
    await wait();
    check(Math.abs(viewport.scrollTop - pausedTop) <= 1, "blur pauses the active trip");
    answerBody.style.marginTop = "64px";
    await wait();
    const resumeTop = viewport.scrollTop;
    window.dispatchEvent(new Event("focus"));
    check(Math.abs(viewport.scrollTop - resumeTop) <= 1, "resume starts at the current position");
   }
   const revealPositions = [viewport.scrollTop];
   await waitFor(() => {
    revealPositions.push(viewport.scrollTop);
    return Math.abs(answerBody.getBoundingClientRect().top - get("pinned-prompt").getBoundingClientRect().bottom - 8) <= 2;
   }, "answer reveal finishes its smooth travel");
   if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    check(new Set(revealPositions.map((position) => Math.round(position))).size >= 3, "answer reveal paints intermediate positions");
   }
   const promptBottom = get("pinned-prompt").getBoundingClientRect().bottom;
   check(answerBody.textContent.includes("Paragraph 35"), "reveal waits for the final paragraph");
   check(!get("pinned-prompt").hidden, "answer reveal updates the sticky prompt");
   check(Math.abs(answerBody.getBoundingClientRect().top - promptBottom - 8) <= 2, "answer begins below the sticky prompt");
   check(answerNode.closest(".message-slot").dataset.turnOpen === "false", "process folds before answer reveal");
   check(document.activeElement === focusedBeforeAnswer, "answer reveal preserves keyboard focus");
   const revealedTop = viewport.scrollTop;
   await post(snapshot("answer-reveal", [...longHistory, revealPrompt, step, answer]));
   check(Math.abs(viewport.scrollTop - revealedTop) <= 1, "snapshot preserves the revealed start");
   viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 120 }));
   viewport.scrollTop += 120;
   viewport.dispatchEvent(new Event("scroll"));
   await wait();
   const readerTop = viewport.scrollTop;
   await rpc({ type: "agent_settled" });
   await rpc({ type: "extension_ui_request", method: "setWidget", widgetKey: "refresh", widgetLines: ["refreshed"] });
   window.dispatchEvent(new Event("resize"));
   await wait();
   check(Math.abs(viewport.scrollTop - readerTop) <= 1, "duplicate completion and later render do not move the reader");
   await rpc({ type: "agent_start" });
   await rpc({ type: "message_start", message: { role: "user", content: "a second long answer", timestamp: 7400 } });
   const interruptedAnswer = { ...answer, timestamp: 7500, content: [{ type: "text", text: "Interrupt this reveal.\n\n" + answerText }] };
   await rpc({ type: "message_start", message: { ...interruptedAnswer, content: [] } });
   await rpc({ type: "message_end", message: interruptedAnswer });
   await rpc({ type: "agent_settled" });
   await waitFor(() => [...get("messages").querySelectorAll(".assistant-message")].at(-1)?.closest(".message-slot")?.querySelector("[data-copy-key]"), "second answer finishes playback");
   const interruptedBody = [...get("messages").querySelectorAll(".assistant-text")].at(-1);
   if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    check(Math.abs(interruptedBody.getBoundingClientRect().top - get("pinned-prompt").getBoundingClientRect().bottom - 8) > 20, "the second reveal is still moving");
   }
   viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -60 }));
   viewport.scrollTop -= 60;
   viewport.dispatchEvent(new Event("scroll"));
   const interruptedTop = viewport.scrollTop;
   await new Promise((resolve) => setTimeout(resolve, 750));
   check(Math.abs(viewport.scrollTop - interruptedTop) <= 1, "reader wheel cancels the remaining animation");
   check(document.activeElement === focusedBeforeAnswer, "animation and cancellation preserve keyboard focus");
   await rpc({ type: "agent_start" });
   await rpc({ type: "message_start", message: { role: "user", content: "cancel a background reveal", timestamp: 7600 } });
   const backgroundAnswer = { ...answer, timestamp: 7800, content: [{ type: "text", text: "Background answer.\n\n" + answerText }] };
   await rpc({ type: "message_start", message: { ...backgroundAnswer, content: [] } });
   await rpc({ type: "message_end", message: backgroundAnswer });
   window.dispatchEvent(new Event("blur"));
   await rpc({ type: "agent_settled" });
   await waitFor(() => [...get("messages").querySelectorAll(".assistant-message")].at(-1)?.closest(".message-slot")?.querySelector("[data-copy-key]"), "third answer completes while unfocused");
   viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -80 }));
   viewport.scrollTop -= 80;
   viewport.dispatchEvent(new Event("scroll"));
   const cancelledBackgroundTop = viewport.scrollTop;
   window.dispatchEvent(new Event("focus"));
   await new Promise((resolve) => setTimeout(resolve, 750));
   check(Math.abs(viewport.scrollTop - cancelledBackgroundTop) <= 1, "manual scrolling cancels a background request before focus");
   check(document.activeElement === focusedBeforeAnswer, "background pause and resume preserve keyboard focus");
   await post({ type: "setComposerText", text: "next question" });
   get("send-button").click();
   await wait();
   const submit = sent.findLast((item) => item.type === "submit");
   check(submit?.text === "next question", "next prompt uses the real send flow");
   await rpc({ type: "message_start", message: { role: "user", content: "next question", timestamp: 8000 } });
   await post({ type: "actionResult", actionId: submit.actionId, ok: true });
   await waitFor(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2, "next submit restores following");
   await post({ type: "connection", phase: "error", detail: "Disconnected" });
   check(get("prompt-input").disabled && !get("connection-banner").hidden, "disconnect disables composer and shows banner");
   check(errors.length === 0, "no runtime errors");
   document.body.dataset.testComplete = "true";
  } catch (error) { document.body.dataset.testError = errors[0] || error.stack || String(error); }
 }
})();
