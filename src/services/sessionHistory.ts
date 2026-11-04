/// <reference types="node" />

import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Rebuilds a pi session around an edit, without touching the original file.
 *
 * pi's session is an append-only tree: every entry names its `parentId`, and the
 * active branch is the chain from the header down to the current leaf. pi's RPC
 * exposes no command that removes or rewrites history — `fork` can only start a
 * new session at a *user* prompt, and an extension cannot reach a mutable session
 * manager — so a deletion has to be expressed as a different tree.
 *
 * The rule this file exists to enforce: **never rewrite the file pi is holding**.
 * A mutation produces a *new* session file whose header names the original as its
 * `parentSession`, and the host then switches pi onto it with `switch_session`.
 * The original keeps every entry it ever had, so switching back is the undo, and
 * a half-written tree can never be the session someone is reading.
 *
 * Everything here is a pure function over parsed JSON except
 * `writeSessionDocument`, and the format is validated before anything is
 * derived from it: an unknown version or a malformed entry fails closed, so a
 * pi release that changes the shape cannot silently mangle a conversation.
 */

/** The only session format this module understands. */
export const SUPPORTED_SESSION_VERSION = 3;

const MAX_SESSION_BYTES = 64 * 1024 * 1024;

export class SessionHistoryError extends Error {}

export interface SessionEntry {
	type: string;
	id: string;
	parentId: string | null;
	timestamp?: string;
	message?: { role?: string; content?: unknown; timestamp?: number };
	[key: string]: unknown;
}

export interface SessionHeader {
	type: "session";
	version: number;
	id: string;
	timestamp?: string;
	cwd?: string;
	parentSession?: string;
	[key: string]: unknown;
}

export interface SessionDocument {
	header: SessionHeader;
	entries: SessionEntry[];
	byId: Map<string, SessionEntry>;
}

export interface SessionPlan {
	header: SessionHeader;
	entries: SessionEntry[];
}

/**
 * Parses and fully validates one session file.
 *
 * Throws `SessionHistoryError` with a human-readable reason; the caller turns it
 * into an `actionResult` failure and leaves the session exactly as it was.
 */
export function readSessionDocument(contents: string): SessionDocument {
	if (contents.length > MAX_SESSION_BYTES) {
		throw new SessionHistoryError("This session file is too large to rewrite safely.");
	}
	const lines = contents.split(/\r?\n/u).filter((line) => line.trim().length > 0);
	if (lines.length === 0) throw new SessionHistoryError("This session file is empty.");

	const header = parseLine(lines[0]!, 0);
	if (header.type !== "session") throw new SessionHistoryError("This file is not a pi session.");
	const version = header.version;
	if (version !== SUPPORTED_SESSION_VERSION) {
		throw new SessionHistoryError(
			`This session uses format version ${String(version)}; only version ${SUPPORTED_SESSION_VERSION} can be rewritten.`,
		);
	}
	if (typeof header.id !== "string" || !header.id) {
		throw new SessionHistoryError("The session header has no id.");
	}

	const entries: SessionEntry[] = [];
	const byId = new Map<string, SessionEntry>();
	for (let index = 1; index < lines.length; index += 1) {
		const entry = toSessionEntry(parseLine(lines[index]!, index), index);
		if (byId.has(entry.id)) {
			throw new SessionHistoryError(`Entry id ${entry.id} appears twice.`);
		}
		entries.push(entry);
		byId.set(entry.id, entry);
	}

	return { header: header as SessionHeader, entries, byId };
}

function parseLine(line: string, index: number): Record<string, unknown> & { [key: string]: unknown } {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		throw new SessionHistoryError(`Line ${index + 1} of this session is not valid JSON.`);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new SessionHistoryError(`Line ${index + 1} of this session is not an object.`);
	}
	return value as Record<string, unknown> & { [key: string]: unknown };
}

/**
 * Names one validated line an entry.
 *
 * The checks run before the object is typed as a `SessionEntry`: casting first
 * would let a malformed row travel as if it had already been validated.
 */
function toSessionEntry(parsed: Record<string, unknown>, index: number): SessionEntry {
	if (typeof parsed.type !== "string" || !parsed.type) {
		throw new SessionHistoryError(`Entry ${index} has no type.`);
	}
	if (typeof parsed.id !== "string" || !parsed.id) {
		throw new SessionHistoryError(`Entry ${index} has no id.`);
	}
	if (parsed.parentId !== null && typeof parsed.parentId !== "string") {
		throw new SessionHistoryError(`Entry ${index} has an invalid parentId.`);
	}
	return { ...parsed, type: parsed.type, id: parsed.id, parentId: parsed.parentId };
}

/** The chain from the current leaf back to its root, oldest first. */
export function activeBranch(document: SessionDocument, leafId: string | null): SessionEntry[] {
	if (!leafId) return [];
	const branch: SessionEntry[] = [];
	const seen = new Set<string>();
	let current = document.byId.get(leafId);
	while (current) {
		if (seen.has(current.id)) throw new SessionHistoryError("This session contains a parent cycle.");
		seen.add(current.id);
		branch.push(current);
		current = current.parentId ? document.byId.get(current.parentId) : undefined;
	}
	return branch.reverse();
}

/**
 * The newest entry on the active branch, which is what the reader is looking at.
 *
 * A session is append-only and a parent is always written before its child, so
 * the last entry nothing claims is the leaf. The backward scan keeps that true
 * for a file whose last line was itself claimed by an earlier one.
 */
export function activeLeafId(document: SessionDocument): string | null {
	const claimed = new Set<string>();
	for (const entry of document.entries) {
		if (entry.parentId) claimed.add(entry.parentId);
	}
	for (let index = document.entries.length - 1; index >= 0; index -= 1) {
		const entry = document.entries[index]!;
		if (!claimed.has(entry.id)) return entry.id;
	}
	return null;
}

function isUserEntry(entry: SessionEntry): boolean {
	return entry.type === "message" && entry.message?.role === "user";
}

/** The user prompts on the active branch, in the order the reader sees them. */
export function promptEntries(document: SessionDocument): SessionEntry[] {
	return activeBranch(document, activeLeafId(document)).filter(isUserEntry);
}

function cloneEntry(entry: SessionEntry, parentId: string | null): SessionEntry {
	return { ...entry, parentId };
}

/**
 * Drops one prompt and everything it produced, keeping later prompts.
 *
 * The range is the prompt itself plus every following entry up to — but not
 * including — the next user prompt, which is the same rule PI-Desktop uses: the
 * reply, its tool calls and its tool results all belong to that turn. The first
 * surviving entry is re-parented onto the prompt's parent, which is what makes
 * the remaining turns a valid chain rather than an orphaned fragment.
 */
export function planDeletePrompt(document: SessionDocument, promptEntryId: string): SessionPlan {
	const branch = activeBranch(document, activeLeafId(document));
	const index = branch.findIndex((entry) => entry.id === promptEntryId);
	if (index < 0) throw new SessionHistoryError("That message is not on the active branch.");
	if (!isUserEntry(branch[index]!)) throw new SessionHistoryError("Only a prompt can be deleted.");

	let end = index + 1;
	while (end < branch.length && !isUserEntry(branch[end]!)) end += 1;

	const removed = new Set(branch.slice(index, end).map((entry) => entry.id));
	const parentId = branch[index]!.parentId;
	return rebuild(document, branch, parentId, removed);
}

/**
 * Drops the prompt and everything after it.
 *
 * Edit and regenerate both use this: the replies that followed answered the old
 * text, so keeping them would leave the transcript contradicting itself. The
 * replacement text is deliberately not written here — the host replays the
 * prompt and pi appends the new user entry, so pi keeps ownership of the message
 * shape and the usage accounting.
 */
export function planTruncateFromPrompt(
	document: SessionDocument,
	promptEntryId: string,
): SessionPlan {
	const branch = activeBranch(document, activeLeafId(document));
	const index = branch.findIndex((entry) => entry.id === promptEntryId);
	if (index < 0) throw new SessionHistoryError("That message is not on the active branch.");
	if (!isUserEntry(branch[index]!)) throw new SessionHistoryError("Only a prompt can be rewritten.");

	const removed = new Set(branch.slice(index).map((entry) => entry.id));
	return rebuild(document, branch, branch[index]!.parentId, removed);
}

/**
 * Whether a plan still holds a prompt for the reader to see.
 *
 * pi cannot open a session with no user turn: switching to such a file dies
 * inside its own loader with "Invalid array length". So the host asks this
 * before writing, and expresses the empty result as a fresh session instead.
 */
export function planHoldsUserTurn(plan: SessionPlan): boolean {
	return plan.entries.some(
		(entry) => entry.type === "message" && entry.message?.role === "user",
	);
}

/**
 * Copies the branch minus the removed ids, healing the one link the cut breaks.
 *
 * Entries before the cut keep the parent they already have — their parents are
 * still in the file. Only the first entry *after* the gap is re-parented, onto
 * the node that came before it. Re-pointing the whole surviving prefix at the
 * gap's parent (the obvious implementation) makes the first entry name the last
 * one as its parent: the branch becomes a cycle and pi refuses to open the file.
 *
 * Only the active branch is copied: a session may hold abandoned branches, and
 * carrying them into a rewritten tree would resurrect turns the reader deleted.
 */
function rebuild(
	document: SessionDocument,
	branch: readonly SessionEntry[],
	gapParentId: string | null,
	removed: ReadonlySet<string>,
): SessionPlan {
	const kept: SessionEntry[] = [];
	let reconnectTo = gapParentId;
	let afterGap = false;
	for (const entry of branch) {
		if (removed.has(entry.id)) {
			afterGap = true;
			continue;
		}
		const parentId = afterGap ? reconnectTo : entry.parentId;
		kept.push(cloneEntry(entry, parentId));
		afterGap = false;
		reconnectTo = entry.id;
	}
	return { header: { ...document.header }, entries: kept };
}


/**
 * Points a plan at a brand-new session file.
 *
 * `parentSession` is what makes the rewrite reversible in pi's own terms: the new
 * file records where it came from, and the original stays exactly as it was.
 */
export function withNewIdentity(plan: SessionPlan, originalPath: string, now = new Date()): SessionPlan {
	return {
		header: {
			...plan.header,
			id: randomUUID(),
			timestamp: now.toISOString(),
			parentSession: path.resolve(originalPath),
		},
		entries: plan.entries,
	};
}

/** Serializes a plan back into pi's newline-delimited JSON. */
export function serializeSession(plan: SessionPlan): string {
	const lines = [JSON.stringify(plan.header), ...plan.entries.map((entry) => JSON.stringify(entry))];
	return `${lines.join("\n")}\n`;
}

/**
 * Writes the plan beside the original and returns the new path.
 *
 * `rename` is the atomic step: a reader (or pi) either sees the whole file or
 * none of it. The original is never opened for writing.
 */
export async function writeSessionDocument(targetPath: string, plan: SessionPlan): Promise<string> {
	const temporary = `${targetPath}.${randomUUID()}.tmp`;
	await writeFile(temporary, serializeSession(plan), "utf8");
	try {
		await rename(temporary, targetPath);
	} catch (error) {
		await unlink(temporary).catch(() => undefined);
		throw error;
	}
	return targetPath;
}

/** Builds the sibling path a rewrite lands on, matching pi's own naming. */
export function rewrittenSessionPath(originalPath: string, now = new Date()): string {
	const stamp = now.toISOString().replace(/[:.]/gu, "-");
	return path.join(path.dirname(originalPath), `${stamp}_${randomUUID()}.jsonl`);
}

export async function loadSessionDocument(sessionPath: string): Promise<SessionDocument> {
	return readSessionDocument(await readFile(sessionPath, "utf8"));
}
