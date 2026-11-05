import assert from "node:assert/strict";
import test from "node:test";

import { loadBundledModule } from "../../helpers/load-bundled-module.mjs";

const { module, dispose } = await loadBundledModule({
	entry: "src/services/trellisTasks.ts",
	name: "trellis-tasks",
});
test.after(dispose);
const { TrellisTasks, describeFailure, parseCreatedTaskDir, trellisTaskPrompt } =
	module;
const root = "D:/code/pi-agent-sidebar";

/** Records what would have run and answers with the given stdout. */
function fakeRunner({ stdout = "", failOn = undefined, stderr = "" } = {}) {
	const calls = [];
	const run = async (command, args, options) => {
		calls.push({ command, args, options });
		if (command === failOn) {
			const error = new Error(`Command failed: ${command}`);
			error.stderr = stderr;
			throw error;
		}
		return command.startsWith("python") ? stdout : "";
	};
	return { calls, run };
}

test("create runs task.py with the title and description it was given", async () => {
	const { calls, run } = fakeRunner({
		stdout: "noise\n.trellis/tasks/11-05-add-badge\n",
	});
	const trellis = new TrellisTasks(run);
	const dir = await trellis.create(root, "  Add badge  ", "  Show usage  ");

	assert.equal(dir, ".trellis/tasks/11-05-add-badge");
	const create = calls.at(-1);
	assert.equal(create.command, "python");
	assert.deepEqual(create.args, [
		".trellis/scripts/task.py",
		"create",
		"Add badge",
		"--description",
		"Show usage",
	]);
	assert.equal(create.options.cwd, root);
});

test("create falls back to python3 and keeps the script's refusal", async () => {
	const calls = [];
	const run = async (command, args, options) => {
		calls.push(command);
		if (command === "python") throw new Error("not found");
		if (command === "python3" && args.includes("create")) {
			const error = new Error("Command failed");
			error.stderr = "Error: Task already exists: 11-05-add-badge\n";
			throw error;
		}
		return ".trellis/tasks/11-05-add-badge\n";
	};
	const trellis = new TrellisTasks(run);
	await assert.rejects(
		() => trellis.create(root, "Add badge", "Show usage"),
		// The script's own words, not the wrapped spawn error.
		/Task already exists: 11-05-add-badge/u,
	);
	assert.ok(calls.includes("python3"));
});

test("create refuses empty input before starting a process", async () => {
	const { calls, run } = fakeRunner();
	const trellis = new TrellisTasks(run);
	await assert.rejects(() => trellis.create(root, "   ", "x"), /title is required/u);
	await assert.rejects(() => trellis.create(root, "x", "  "), /description is required/u);
	assert.equal(calls.length, 0);
});

test("parseCreatedTaskDir normalizes separators and takes the last line", () => {
	assert.equal(
		parseCreatedTaskDir(".trellis\\tasks\\11-05-a\r\n.trellis\\tasks\\11-05-b\r\n"),
		".trellis/tasks/11-05-b",
	);
	assert.throws(() => parseCreatedTaskDir("Created task: whatever"), /did not report/u);
});

test("describeFailure prefers the script's Error line", () => {
	const error = new Error("spawn failed");
	error.stderr = "Warning: something\nError: No developer set.\nmore";
	assert.equal(describeFailure(error), "No developer set.");
	assert.equal(describeFailure(new Error("plain")), "plain");
});

test("the prompt names the task directory and asks for requirements first", () => {
	const prompt = trellisTaskPrompt(".trellis/tasks/11-05-a", "T", "D");
	assert.match(prompt, /\.trellis\/tasks\/11-05-a/u);
	assert.match(prompt, /\/trellis-brainstorm/u);
	assert.match(prompt, /prd\.md/u);
});
