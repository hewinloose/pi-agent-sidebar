/**
 * Elapsed time for a running tool call.
 *
 * The transcript already shows a call's state as a breathing border, but a
 * border cannot tell "still working" apart from "wedged". A sub-agent that
 * dispatches three children can legitimately run for minutes, and without a
 * counter the reader has no way to know that anything is happening — the
 * failure this exists to prevent.
 *
 * Pure and DOM-free so it can be tested directly, and so the label can be
 * refreshed from a timer without going through the render signature.
 */

/** Below one second there is nothing useful to say, so say nothing. */
export const ELAPSED_MIN_MS = 1_000;

/**
 * Whole seconds under a minute (`42s`), then minutes (`1m 05s`), then hours
 * (`1h 02m`).
 *
 * Fixed-width digits after the first unit keep the label from twitching as the
 * number grows, which matters because it is rewritten every second in place.
 */
export function formatElapsed(elapsedMs: number): string {
	if (!Number.isFinite(elapsedMs) || elapsedMs < ELAPSED_MIN_MS) return "";
	const totalSeconds = Math.floor(elapsedMs / 1000);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const seconds = totalSeconds % 60;
	const minutes = Math.floor(totalSeconds / 60);
	if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * The label for a call that started at `startedAt` and is still running.
 *
 * Returns `""` for calls with no usable start time: pi replays historical calls
 * through the same renderer, and a synthesised `startedAt` of 0 would otherwise
 * render as a 59-year duration.
 */
export function runningElapsedLabel(startedAt: number, now: number): string {
	if (!Number.isFinite(startedAt) || startedAt <= 0) return "";
	return formatElapsed(now - startedAt);
}
