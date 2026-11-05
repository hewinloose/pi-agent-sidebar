import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type TaskRunner = (
	command: string,
	args: string[],
	options: { cwd: string },
) => Promise<string>;

const TASK_SCRIPT = ".trellis/scripts/task.py";
const PYTHON_CANDIDATES = ["python", "python3"] as const;

/**
 * `task.py create` prints a human summary on stderr and the new task directory —
 * repo-relative — as the last line of stdout, so that line is the parse target.
 */
const CREATED_TASK_DIR = /^\.trellis[\\/]tasks[\\/].+$/u;

/** A refusal Trellis gave, already phrased for a person. */
export class TrellisTaskError extends Error {}

/**
 * Creates Trellis tasks through Trellis's own script.
 *
 * The extension must not lay out task directories itself: numbering, `task.json`,
 * and the seeded artifacts are Trellis's contract, and pi is the one that reads
 * them. This runs `task.py create` and reports the directory it printed.
 */
export class TrellisTasks {
	public constructor(
		/** Injected so the parsing and prompt rules stay testable without a child process. */
		private readonly run: TaskRunner = (command, args, options) =>
			execFileAsync(command, args, {
				cwd: options.cwd,
				// Detached windows have no console to flash, and stderr is parsed.
				windowsHide: true,
			}).then(({ stdout }) => stdout),
	) {}

	/**
	 * Whether this folder has a Trellis workspace to create tasks in.
	 *
	 * Only the layout is checked: a missing Python is reported when the reader
	 * asks for a task, not by hiding the button they were looking for.
	 */
	public async available(workspaceRoot: string): Promise<boolean> {
		return fileExists(join(workspaceRoot, TASK_SCRIPT));
	}

	/** The repo-relative task directory, e.g. `.trellis/tasks/11-05-add-foo`. */
	public async create(
		workspaceRoot: string,
		title: string,
		description: string,
	): Promise<string> {
		const trimmedTitle = title.trim();
		if (!trimmedTitle) throw new TrellisTaskError("A task title is required.");
		const trimmedDescription = description.trim();
		if (!trimmedDescription)
			throw new TrellisTaskError("A task description is required.");
		const python = await this.resolvePython(workspaceRoot);
		if (!python)
			throw new TrellisTaskError(
				"Python was not found, so Trellis tasks cannot be created. Install Python or put it on PATH, then reload the window.",
			);
		try {
			// `--description` is required by the script and is what seeds `prd.md`,
			// so the reader's request travels with the task instead of being retyped.
			const stdout = await this.run(
				python,
				[TASK_SCRIPT, "create", trimmedTitle, "--description", trimmedDescription],
				{ cwd: workspaceRoot },
			);
			return parseCreatedTaskDir(stdout);
		} catch (error) {
			throw new TrellisTaskError(describeFailure(error));
		}
	}

	private async resolvePython(workspaceRoot: string): Promise<string | undefined> {
		for (const candidate of PYTHON_CANDIDATES) {
			try {
				await this.run(candidate, ["-c", "import sys; sys.exit(0)"], {
					cwd: workspaceRoot,
				});
				return candidate;
			} catch {
				// Try the next name.
			}
		}
		return undefined;
	}
}

/** The last `.trellis/tasks/...` line of `task.py create`'s stdout. */
export function parseCreatedTaskDir(stdout: string): string {
	const lines = stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => CREATED_TASK_DIR.test(line));
	const line = lines.at(-1);
	if (!line)
		throw new TrellisTaskError(
			"Trellis did not report the task it created. Check the Pi Agent output for the script's message.",
		);
	return line.replaceAll("\\", "/");
}

/**
 * The prompt pi receives after a task is created.
 *
 * Trellis puts requirement exploration before implementation, and `prd.md` is
 * where that has to be written down. The extension stops at "the task exists" and
 * hands the rest to pi, which owns the conversation.
 */
export function trellisTaskPrompt(
	taskDir: string,
	title: string,
	description: string,
): string {
	return [
		`A new Trellis task was created: ${taskDir}`,
		`Title: ${title.trim()}`,
		`Request: ${description.trim()}`,
		"",
		"Use /trellis-brainstorm to explore the requirements for this task and fill in its prd.md before any implementation. Ask one question at a time and update the file after each answer.",
	].join("\n");
}

/**
 * Why the script refused, in its own words.
 *
 * "Task already exists" and "No developer set" are actionable; the wrapped spawn
 * error and the stack trace are not.
 */
export function describeFailure(error: unknown): string {
	const stderr = (error as { stderr?: unknown } | null)?.stderr;
	if (typeof stderr === "string" && stderr.trim()) {
		const lines = stderr
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.filter(Boolean);
		const reason = lines.find((line) => line.startsWith("Error:")) ?? lines[0];
		if (reason) return reason.replace(/^Error:\s*/u, "");
	}
	return error instanceof Error ? error.message : String(error);
}

/** Resolves to whether `path` is a file, without throwing on the usual failures. */
async function fileExists(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}
