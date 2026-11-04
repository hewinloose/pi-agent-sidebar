import assert from "node:assert/strict";
import test from "node:test";
import { loadBundledModule } from "../../helpers/load-bundled-module.mjs";

async function loadRouter() {
	return loadBundledModule({
		entry: "src/provider/webviewMessageRouter.ts",
		name: "webview-message-router",
	});
}

/**
 * A host stand-in that records the option it was asked for.
 *
 * The router only ever touches the one option a message names, so every other
 * member is answered by a recorder instead of being stubbed out one by one —
 * and `respondToAction` is the real shape, because that is what proves the
 * request gets an answer.
 */
function createOptions() {
	const calls = [];
	const responded = [];
	const options = new Proxy(
		{
			respondToAction: async (actionId, operation) => {
				responded.push(actionId);
				await operation();
			},
		},
		{
			get(target, property) {
				if (property in target) return target[property];
				return (...args) => {
					calls.push([property, ...args]);
					return Promise.resolve();
				};
			},
		},
	);
	return { calls, options, responded };
}

test("prompt history actions reach the host with their ordinal, text and answer", async (t) => {
	const loaded = await loadRouter();
	t.after(loaded.dispose);
	const { calls, options, responded } = createOptions();
	const router = new loaded.module.WebviewMessageRouter(options);

	await router.dispatch({ type: "deletePrompt", actionId: "a1", promptOrdinal: 2, text: "hello" });
	await router.dispatch({
		type: "editPrompt",
		actionId: "a2",
		promptOrdinal: 0,
		text: "hello",
		newText: "reworded",
	});
	// An image-only prompt stores no text, and the ordinal is all it has.
	await router.dispatch({ type: "regeneratePrompt", actionId: "a3", promptOrdinal: 1, text: "" });
	await router.dispatch({ type: "forkPrompt", actionId: "a4", promptOrdinal: 5, text: "hello" });

	assert.deepEqual(calls, [
		["onDeletePrompt", 2, "hello"],
		["onEditPrompt", 0, "hello", "reworded"],
		["onRegeneratePrompt", 1, ""],
		["onForkPrompt", 5, "hello"],
	]);
	// Every action answers the request it arrived on, or the row waits forever.
	assert.deepEqual(responded, ["a1", "a2", "a3", "a4"]);
});
