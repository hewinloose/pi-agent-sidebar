import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { loadBundledModule } from "../../helpers/load-bundled-module.mjs";

const modelA = { provider: "first", id: "model", name: "Model A" };
const modelB = { provider: "second", id: "model", name: "Model B" };

async function setupRegeneration(t, { firstPrompt = false } = {}) {
	const loaded = await loadBundledModule({
		entry: "src/provider/piViewProvider.ts",
		plugins: [{
			name: "mock-vscode",
			setup(build) {
				build.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "mock-vscode" }));
				build.onLoad({ filter: /.*/, namespace: "mock-vscode" }, () => ({
					contents: "export const workspace = { onDidChangeWorkspaceFolders: () => ({ dispose() {} }) };",
				}));
			},
		}],
	});
	t.after(loaded.dispose);
	const directory = await mkdtemp(path.join(os.tmpdir(), "pi-sidebar-regenerate-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const timestamp = "2026-01-01T00:00:00.000Z";
	const source = path.join(directory, "original.jsonl");
	const header = { type: "session", version: 3, id: "original", cwd: directory, timestamp };
	const previous = { type: "message", id: "u1", parentId: null, timestamp, message: { role: "user", content: "previous" } };
	const prompt = { type: "message", id: "u2", parentId: firstPrompt ? null : previous.id, timestamp, message: { role: "user", content: "try again" } };
	const stopped = { type: "message", id: "a2", parentId: prompt.id, timestamp, message: { role: "assistant", content: [], stopReason: "aborted" } };
	const history = firstPrompt ? [prompt, stopped] : [previous, prompt, stopped];
	await writeFile(source, [header, ...history].map((entry) => JSON.stringify(entry)).join("\n") + "\n");

	const provider = new loaded.module.PiViewProvider({ globalStorageUri: { fsPath: directory } }, { appendLine() {} });
	const actions = [];
	const prompts = [];
	const replacements = [];
	let model = modelA;
	let thinkingLevel = "low";
	let sessionFile = source;
	provider.models = [modelA, modelB];
	provider.thinkingLevels = ["off", "low", "high"];
	provider.post = async (message) => { actions.push(message); return true; };
	provider.sendSessionList = async () => {};
	provider.client = {
		isRunning: true,
		async request(command) {
			switch (command.type) {
				case "get_state":
					return { sessionFile, model, thinkingLevel };
				case "get_fork_messages":
					return { messages: history.filter((entry) => entry.message.role === "user").map((entry) => ({ entryId: entry.id, text: entry.message.content })) };
				case "switch_session": {
					const branch = (await readFile(command.sessionPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
					assert.deepEqual(branch.slice(1), [previous]);
					sessionFile = command.sessionPath;
					model = modelA;
					thinkingLevel = "low";
					replacements.push(command.type);
					return { cancelled: false };
				}
				case "new_session":
					sessionFile = path.join(directory, "new.jsonl");
					replacements.push(command.type);
					return { cancelled: false };
				case "set_model":
					await setImmediate();
					model = provider.models.find((candidate) => candidate.provider === command.provider && candidate.id === command.modelId);
					assert.ok(model);
					thinkingLevel = "low";
					return model;
				case "set_thinking_level":
					await setImmediate();
					thinkingLevel = command.level;
					return;
				case "prompt":
					prompts.push({ text: command.message, model, thinkingLevel });
					return;
				default:
					assert.fail(`Unexpected RPC: ${command.type}`);
			}
		},
	};
	return { provider, actions, prompts, replacements, promptOrdinal: firstPrompt ? 0 : 1 };
}

for (const firstPrompt of [false, true]) {
	test(`regenerate uses the newly selected model ${firstPrompt ? "in a fresh session" : "after restoring previous turns"}`, async (t) => {
		const { provider, actions, prompts, replacements, promptOrdinal } = await setupRegeneration(t, { firstPrompt });
		const changeModel = provider.webviewMessageRouter.dispatch({ type: "setModel", actionId: "model", provider: modelB.provider, modelId: modelB.id });
		const regenerate = provider.webviewMessageRouter.dispatch({ type: "regeneratePrompt", actionId: "retry", promptOrdinal, text: "try again" });
		await Promise.all([changeModel, regenerate]);
		assert.deepEqual(actions, [
			{ type: "actionResult", actionId: "model", ok: true },
			{ type: "actionResult", actionId: "retry", ok: true },
		]);
		assert.deepEqual(replacements, [firstPrompt ? "new_session" : "switch_session"]);
		assert.deepEqual(prompts, [{ text: "try again", model: modelB, thinkingLevel: "low" }]);
	});
}

for (const [scenario, firstPrompt, nextModel] of [
	["after restoring previous turns", false, modelA],
	["in a fresh session", true, modelA],
	["after restoring the newly selected model", false, modelB],
]) {
	test(`regenerate uses the newly selected thinking level ${scenario}`, async (t) => {
		const { provider, actions, prompts, promptOrdinal } = await setupRegeneration(t, { firstPrompt });
		if (nextModel !== modelA) {
			await provider.webviewMessageRouter.dispatch({ type: "setModel", actionId: "model", provider: nextModel.provider, modelId: nextModel.id });
			assert.deepEqual(actions.pop(), { type: "actionResult", actionId: "model", ok: true });
		}
		const changeThinking = provider.webviewMessageRouter.dispatch({ type: "setThinking", actionId: "thinking", level: "high" });
		const regenerate = provider.webviewMessageRouter.dispatch({ type: "regeneratePrompt", actionId: "retry", promptOrdinal, text: "try again" });
		await Promise.all([changeThinking, regenerate]);
		assert.deepEqual(actions, [
			{ type: "actionResult", actionId: "thinking", ok: true },
			{ type: "actionResult", actionId: "retry", ok: true },
		]);
		assert.deepEqual(prompts, [{ text: "try again", model: nextModel, thinkingLevel: "high" }]);
	});
}
