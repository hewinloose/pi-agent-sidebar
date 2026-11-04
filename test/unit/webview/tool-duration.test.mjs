import assert from "node:assert/strict";
import test from "node:test";
import { loadBundledModule } from "../../helpers/load-bundled-module.mjs";

async function loadToolDuration() {
	return loadBundledModule({
		entry: "webview/transcript/toolDuration.ts",
		name: "tool-duration",
	});
}

test("a running call stays silent until it is worth reporting", async (t) => {
	const loaded = await loadToolDuration();
	t.after(loaded.dispose);
	const { formatElapsed, ELAPSED_MIN_MS } = loaded.module;
	assert.equal(formatElapsed(0), "");
	assert.equal(formatElapsed(999), "");
	assert.equal(formatElapsed(ELAPSED_MIN_MS), "1s");
	// Nothing that is not a real duration should reach the label.
	assert.equal(formatElapsed(Number.NaN), "");
	assert.equal(formatElapsed(-5), "");
});

test("seconds, minutes and hours keep a stable width", async (t) => {
	const loaded = await loadToolDuration();
	t.after(loaded.dispose);
	const { formatElapsed } = loaded.module;
	assert.equal(formatElapsed(12_000), "12s");
	assert.equal(formatElapsed(59_999), "59s");
	assert.equal(formatElapsed(60_000), "1m 00s");
	assert.equal(formatElapsed(65_000), "1m 05s");
	assert.equal(formatElapsed(3_599_000), "59m 59s");
	assert.equal(formatElapsed(3_600_000), "1h 00m");
	assert.equal(formatElapsed(3_780_000), "1h 03m");
});

test("a call with no usable start time renders no label", async (t) => {
	const loaded = await loadToolDuration();
	t.after(loaded.dispose);
	const { runningElapsedLabel } = loaded.module;
	// Historical and synthesised calls pass 0; a label there would read as a
	// 59-year duration.
	assert.equal(runningElapsedLabel(0, 1_000_000), "");
	assert.equal(runningElapsedLabel(Number.NaN, 1_000_000), "");
	assert.equal(runningElapsedLabel(1_000, 14_000), "13s");
});
