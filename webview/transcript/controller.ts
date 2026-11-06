import type { PiContentBlock, PiMessage } from "../../shared/protocol.js";
import type { RpcEventLiveTool } from "../rpcEventReducer.js";
import { contentText } from "../../shared/messageContent.js";
import { adoptSnapshotIdentities, type MessageIdentity } from "./messageIdentity.js";
import { StreamingMessagePlayback } from "./streaming.js";
import { TranscriptView, type TranscriptEntry } from "./transcriptView.js";
import { ProgressiveWindow } from "./progressiveWindow.js";
import { insertReply, withLiveReply } from "./transcriptOrder.js";
import { thinkingGroups } from "./thinkingGroups.js";
import { formatDaySeparator, isNewLocalDay, normalizeEpochMs } from "./messageTime.js";
import { isRenderableMessage, messageRenderSignature } from "./renderer.js";

export interface TranscriptState {
 messages: PiMessage[];
 streamingMessage?: PiMessage;
 streamingIndex: number;
 omittedMessageCount: number;
 /** Prompts the host dropped ahead of `messages`; offsets every history action. */
 omittedPromptCount: number;
 timeContext: { locale: string };
}

export interface MessageRenderContext {
 byKey: ReadonlyMap<string, PiMessage>;
 omitted: number;
 resultMap: ReadonlyMap<string, PiMessage>;
 separatorLabels: ReadonlyMap<string, string>;
 /**
  * Session-wide ordinal of the prompt that opens each message's turn.
  *
  * History actions address prompts from the start of the session, while the
  * transcript only holds a window, so the ordinal cannot be derived from the
  * rendered list alone.
  */
 promptOrdinals: ReadonlyMap<string, number>;
 /** The turn's single process disclosure, keyed by message. */
 turnProcess: ReadonlyMap<string, TurnProcessView>;
 /**
  * Messages that carry their turn's answer.
  *
  * Reply actions belong to the answer, not to every step with prose in it: a
  * step whose only text is an acknowledgment had Copy/Branch/Regenerate under it
  * and read like a second answer.
  */
 answerKeys: ReadonlySet<string>;
 /** Answers that directly follow a step's remark inside their turn. */
 afterStepKeys: ReadonlySet<string>;
}

/**
 * The one process handle a turn carries.
 *
 * A turn is the prompt plus every assistant step it produced. The handle, its
 * counts and its open state belong to the turn: counted per message, a turn of
 * nine steps left nine folded rows in the transcript.
 */
export interface TurnProcessView {
 /** Session-wide ordinal of the prompt that opens the turn. */
 readonly turnId: number;
 /** Whole-turn summary, e.g. `3 个命令`. */
 readonly label: string;
 /** `含思考` when the turn both reasoned and called tools. */
 readonly note: string;
 /** Whether this message carries the turn's only handle. */
 readonly isHead: boolean;
 /** The reader's choice, or the stream default when they have not made one. */
 readonly open: boolean;
}


export interface TranscriptControllerOptions {
 state: TranscriptState;
 container: HTMLElement;
 createNode(entry: TranscriptEntry, previous: Element | undefined, context: MessageRenderContext): Element;
 patchStreaming(slot: Element, message: PiMessage, results: ReadonlyMap<string, PiMessage>, key: string): Element | undefined;
 scheduleRender(): void;
 scheduleMeasure(): void;
 pinToBottom(): void;
 syncJumpButton(): void;
 followFresh(): void;
 clearMediaRefusals(): void;
 now(): number;
}

/** Owns transcript identity, playback, disclosure and reconciliation across sessions. */
export class TranscriptController {
 readonly liveTools = new Map<string, RpcEventLiveTool>();
 readonly toolResults = new Map<string, PiMessage>();
 private readonly turnChoices = new Map<number, boolean>();
 readonly playback: StreamingMessagePlayback;
 private readonly view: TranscriptView<Element>;
 private readonly window = new ProgressiveWindow({ threshold: 60, initial: 40, chunk: 40 });
 private readonly identities = new WeakMap<PiMessage, MessageIdentity>();
 private nextKey = 0;
 private context: MessageRenderContext | undefined;
 private turnProcessByKey: ReadonlyMap<string, TurnProcessView> = new Map();
 private readonly limit = 150;

 constructor(private readonly options: TranscriptControllerOptions) {
  this.playback = new StreamingMessagePlayback();
  this.view = new TranscriptView<Element>({
   container: options.container,
   createNode: (entry, previous) => {
    if (!this.context) throw new Error("createNode called outside transcript render");
    return options.createNode(entry, previous, this.context);
   },
  });
 }

 messageKey(message: PiMessage): string { return `message-${this.identity(message).key}`; }


/**
 * The answer text behind a rendered row, for the row's Copy action.
 *
 * The button carries the row's transcript key rather than its text: the same
 * answer is already in the DOM as rendered HTML, and putting the markdown source
 * back into an attribute would duplicate every answer in the page. Resolving here
 * reads pi's own content, so a fence or a table keeps the shape the reader would
 * paste elsewhere.
 */
copyTextFor(messageKey: string): string | undefined {
 const { state } = this.options;
 const all = state.streamingMessage ? [...state.messages, state.streamingMessage] : state.messages;
 for (const message of all) {
  if (this.messageKey(message) !== messageKey) continue;
  const text = contentText(message.content);
  if (text.trim()) return text;
 }
 return undefined;
}
 private identity(message: PiMessage): MessageIdentity {
  const existing = this.identities.get(message);
  if (existing) return existing;
  const identity = { key: ++this.nextKey, version: 0 };
  this.identities.set(message, identity);
  return identity;
 }
 private inherit(from: PiMessage | undefined, to: PiMessage): void {
  if (!from || from === to) return;
  const previous = this.identities.get(from);
  if (previous) this.identities.set(to, { key: previous.key, version: previous.version + 1 });
 }
 private signature = (message: PiMessage): string => {
  const identity = this.identity(message);
  return `${identity.key}.${identity.version}`;
 };

 /** Adopt before swapping arrays so unchanged snapshots preserve nodes and disclosure state. */
 adoptSnapshot(messages: PiMessage[]): void {
  const { state } = this.options;
  adoptSnapshotIdentities({
   previous: state.messages, next: messages, windowSize: this.limit * 2,
   identityOf: (message) => this.identities.get(message),
   adopt: (message, identity) => this.identities.set(message, { ...identity }),
  });
  state.messages = messages;
 }

 reconcileSnapshot(sessionChanged: boolean, isStreaming: boolean): void {
  const { state } = this.options;
  const live = state.streamingMessage;
  const finishing = this.playback.isFinishing;
  let listed: PiMessage | undefined;
  if (finishing && live) {
   for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const candidate = state.messages[index];
    if (candidate && isSameMessage(candidate, live)) { listed = candidate; break; }
   }
  }
  if (listed && live) {
   this.playback.reset();
   state.streamingIndex = state.messages.indexOf(listed);
   this.settle(listed);
  } else if (live && !sessionChanged && (finishing || isStreaming)) {
   state.streamingIndex = state.messages.length;
  } else {
   this.playback.reset();
   state.streamingMessage = undefined;
  }
  this.liveTools.clear();
  this.toolResults.clear();
  for (const message of state.messages) {
   if (message.role === "toolResult" && message.toolCallId) this.toolResults.set(message.toolCallId, message);
  }
  if (sessionChanged) {
  this.turnChoices.clear();
   this.options.clearMediaRefusals();
   this.view.clear();
  }
  if (sessionChanged || this.view.size === 0) this.options.followFresh();
 }

 advance(timestamp: number): boolean {
  const frame = this.playback.advance(timestamp);
  if (!frame) return this.playback.needsFrame;
  if (frame.completed) {
   this.settle(frame.message);
   this.options.scheduleMeasure();
   return false;
  }
  this.inherit(this.options.state.streamingMessage, frame.message);
  this.options.state.streamingMessage = frame.message;
  return this.playback.needsFrame;
 }

 /** Settle in pi's order: follow-ups arriving during playback belong after this reply. */
 settle(message: PiMessage): void {
  const { state } = this.options;
  // Identity is inherited before the key is read: a settled reply arrives as a
  // new object, and allocating a fresh key here would collapse the wrong node.
  this.inherit(state.streamingMessage, message);
  if (!hasEquivalentTail(state.messages, message)) insertReply(state.messages, message, state.streamingIndex);
  state.streamingMessage = undefined;
 }

 interrupt(detail?: string): void {
  const active = this.playback.completeImmediately() ?? this.options.state.streamingMessage;
  if (active) this.settle({ ...active, stopReason: "aborted" });
  for (const tool of this.liveTools.values()) {
   if (tool.status !== "running") continue;
   tool.status = "error";
   if (tool.result === undefined) {
    tool.result = { content: [{ type: "text", text: detail || "Pi disconnected before this tool completed." }] };
   }
   tool.revision += 1;
  }
 }

 renderStreamingFrame(): void {
  const message = this.options.state.streamingMessage;
  const key = message && this.messageKey(message);
  const slot = key && this.view.nodeFor(key);
  if (!message || !key || !slot || !this.options.patchStreaming(slot, message, this.toolResults, key)) this.render();
  this.options.pinToBottom();
  this.options.syncJumpButton();
 }

 render(): void {
  const { state } = this.options;
  const streaming = state.streamingMessage;
  const content = streaming?.content;
  const live = (typeof content === "string" || Array.isArray(content)) && content.length > 0 ? streaming : undefined;
  const renderable = withLiveReply(state.messages, live, state.streamingIndex).filter(isRenderableMessage);
  const capped = renderable.slice(-this.limit);
  const visible = this.window.window(capped, this.view.size === 0);
  const omitted = renderable.length - capped.length + state.omittedMessageCount;
  const owners = this.turnOwners();
  const turnProcess = this.turnProcess(visible, owners);
  const answerKeys = this.turnAnswers(visible, owners);
  const afterStepKeys = this.turnAnswerGaps(visible, owners, answerKeys);
  const entries: TranscriptEntry[] = omitted > 0 ? [{ key: "history-omitted", signature: `omitted:${omitted}` }] : [];
  const byKey = new Map<string, PiMessage>();
  const separatorLabels = new Map<string, string>();
  let previousEpoch: number | undefined;
  for (const message of visible) {
   const key = this.messageKey(message);
   byKey.set(key, message);
   const epoch = normalizeEpochMs(message.timestamp);
   if (epoch !== undefined) {
    if (isNewLocalDay(previousEpoch, epoch)) {
     const label = formatDaySeparator(epoch, this.options.now(), state.timeContext.locale || undefined);
     separatorLabels.set(`day-${key}`, label);
     entries.push({ key: `day-${key}`, signature: `day:${label}` });
    }
    previousEpoch = epoch;
   }
  entries.push({ key, signature: `${messageRenderSignature(message, this.toolResults, this.liveTools, message === streaming, this.signature)}|ts${epoch ?? "-"}|tp${turnProcessSignature(turnProcess.get(key))}|ans${answerKeys.has(key) ? 1 : 0}|gap${afterStepKeys.has(key) ? 1 : 0}` });
  }
  this.turnProcessByKey = turnProcess;
  this.context = { byKey, omitted, resultMap: this.toolResults, separatorLabels, promptOrdinals: owners.ordinals, turnProcess, answerKeys, afterStepKeys };
  try { this.view.update(entries); } finally { this.context = undefined; }
  if (visible.length < capped.length) this.options.scheduleRender();
 }

 /**
  * Maps every known message to the prompt that opens its turn.
  *
  * Walks the whole snapshot, not the rendered window: the window is a suffix, so
  * its first assistant reply may already have lost the prompt it answers, and
  * guessing there would address the wrong turn. `current` is the turn a live
  * reply belongs to before the list holds it.
  */
 private turnOwners(): { ordinals: Map<string, number>; current: number } {
  const ordinals = new Map<string, number>();
  let next = this.options.state.omittedPromptCount;
  let owning: number | undefined;
  for (const message of this.options.state.messages) {
   if (message.role === "user") owning = next++;
   if (owning !== undefined) ordinals.set(this.messageKey(message), owning);
  }
  return { ordinals, current: owning ?? Math.max(next - 1, 0) };
 return { ordinals, current: owning ?? Math.max(next - 1, 0) };
 }

 /**
  * Marks each turn's answered message: its last assistant message that carries
  * prose and has finished.
  *
  * "Finished" is what keeps the action row off a moving target. While a step is
  * still being written it is `state.streamingMessage`; an intermediate step ends
  * with `stopReason: "toolUse"`. Neither is an answer, so neither shows Copy /
  * Branch / Regenerate — before this, the step that streamed the acknowledgment
  * owned the row until the real answer started, and the answer itself owned a
  * lone Copy while it was still streaming.
  *
  * Read over the rendered list so a step that is not on screen cannot claim the
  * actions. A turn with no prose at all (tools only) marks nothing.
  */
 private turnAnswers(
  visible: readonly PiMessage[],
  owners: { ordinals: ReadonlyMap<string, number>; current: number },
 ): ReadonlySet<string> {
  const { streamingMessage } = this.options.state;
  const last = new Map<number, string>();
  for (const message of visible) {
   if (message.role !== "assistant" || !hasAnswerText(message)) continue;
   if (message === streamingMessage) continue;
   if (message.stopReason === "toolUse") continue;
   const key = this.messageKey(message);
   last.set(owners.ordinals.get(key) ?? owners.current, key);
  }
  return new Set(last.values());
 }

 /**
  * The turn's single process handle, counted over the whole turn.
  *
  * Counts come from `state.messages`, not from the rendered window: a turn whose
  * first steps slid past the progressive window must not shrink its own summary.
  * The handle itself lands on the first *rendered* step that has activity, which
  * is the turn's real first step whenever the window holds it.
  */
 private turnProcess(
  visible: readonly PiMessage[],
  owners: { ordinals: ReadonlyMap<string, number>; current: number },
 ): ReadonlyMap<string, TurnProcessView> {
  const { state } = this.options;
  const live = state.streamingMessage;
  const liveTurn = live ? owners.ordinals.get(this.messageKey(live)) ?? owners.current : undefined;
  const all = live && !state.messages.includes(live) ? [...state.messages, live] : state.messages;
  const stats = new Map<number, { tools: number; commandsOnly: boolean; thinkingRuns: number }>();
  // A turn still working on its next step keeps its handle open. `streamingMessage`
  // alone cannot say that: pi settles every step, so between two steps it is empty
  // and the handle folded and reopened on each boundary. A step that ended with
  // `stopReason: "toolUse"` is the durable signal that the turn has not answered yet.
  const running = new Set<number>();
  for (const message of all) {
   if (message.role !== "assistant") continue;
   const turnId = owners.ordinals.get(this.messageKey(message)) ?? owners.current;
   const blocks = messageBlocks(message);
   const tools = blocks.filter((block) => block.type === "toolCall" && block.id && block.name);
   const entry = stats.get(turnId) ?? { tools: 0, commandsOnly: true, thinkingRuns: 0 };
   entry.thinkingRuns += thinkingGroups(blocks).length;
   if (tools.length > 0) {
    entry.tools += tools.length;
    entry.commandsOnly = entry.commandsOnly && tools.every((block) => block.name === "bash");
   }
   stats.set(turnId, entry);
   if (message.stopReason === "toolUse") running.add(turnId);
   else running.delete(turnId);
  }
  const heads = new Map<number, string>();
  for (const message of visible) {
   const key = this.messageKey(message);
   const turnId = owners.ordinals.get(key) ?? owners.current;
   if (heads.has(turnId) || !hasActivity(message)) continue;
   heads.set(turnId, key);
  }
  const result = new Map<string, TurnProcessView>();
  for (const message of visible) {
   const key = this.messageKey(message);
   const turnId = owners.ordinals.get(key) ?? owners.current;
   const entry = stats.get(turnId);
   if (!entry || (entry.tools === 0 && entry.thinkingRuns === 0)) continue;
   result.set(key, {
    turnId,
   label:
    entry.tools === 0
     ? `${entry.thinkingRuns} 个思考步骤`
     : entry.commandsOnly
      ? `${entry.tools} 个命令`
      : `${entry.tools} 次工具操作`,
   note: entry.tools > 0 && entry.thinkingRuns > 0 ? "含思考" : "",
   isHead: heads.get(turnId) === key,
   open: this.turnChoices.get(turnId) ?? (turnId === liveTurn || running.has(turnId)),
   });
  }
  return result;
 }

 /**
  * Marks answers that directly follow a step of the same turn.
  *
  * The two slots are adjacent, so the transcript's own gap plus the answer's
  * top padding opened a full blank line between a step's remark and the prose
  * that answers it. CSS cancels the gap for these slots and leaves the padding.
  */
 private turnAnswerGaps(
  visible: readonly PiMessage[],
  owners: { ordinals: ReadonlyMap<string, number>; current: number },
  answerKeys: ReadonlySet<string>,
 ): ReadonlySet<string> {
  const gaps = new Set<string>();
  const lastByTurn = new Map<number, string>();
  for (const message of visible) {
   // Only a preceding assistant step counts: the prompt opens the turn and must
   // keep the transcript's gap to the answer it produced.
   if (message.role !== "assistant") continue;
   const key = this.messageKey(message);
   const turnId = owners.ordinals.get(key) ?? owners.current;
   if (answerKeys.has(key) && lastByTurn.has(turnId)) gaps.add(key);
   lastByTurn.set(turnId, key);
  }
  return gaps;
 }

 /** The turn disclosure for a rendered message, for the streaming patcher. */
 turnProcessFor(messageKey: string): TurnProcessView | undefined {
  return this.turnProcessByKey.get(messageKey);
 }

 /**
  * Applies the reader's decision to every rendered step of the turn.
  *
  * The choice is stored per turn rather than on the slot: a turn is many slots,
  * and any of them rebuilt by a later frame must come back with the same state.
  */
 setTurnProcess(turnId: number, open: boolean): void {
  this.turnChoices.set(turnId, open);
  for (const slot of this.options.container.querySelectorAll<HTMLElement>(".message-slot")) {
   if (slot.dataset.turnId !== String(turnId)) continue;
   slot.dataset.turnOpen = open ? "true" : "false";
   slot.querySelector<HTMLElement>('[data-expandable="process"]')?.setAttribute("aria-expanded", open ? "true" : "false");
  }
  this.options.scheduleMeasure();
 }
}

export function messageBlocks(message: PiMessage): readonly PiContentBlock[] {
 return Array.isArray(message.content) ? message.content : [];
}
export function isSameMessage(left: PiMessage, right: PiMessage): boolean {
 if (left.role !== right.role) return false;
 if (left.timestamp && right.timestamp) return left.timestamp === right.timestamp;
 return contentText(left.content) === contentText(right.content);
}
export function hasEquivalentTail(messages: PiMessage[], candidate: PiMessage): boolean {
 const tail = messages.at(-1);
 return Boolean(tail && isSameMessage(tail, candidate));
}

/** Whether a message carries any reasoning or tool call to fold into a turn. */
function hasActivity(message: PiMessage): boolean {
 if (message.role !== "assistant") return false;
 for (const block of messageBlocks(message)) {
  if (block.type === "thinking") return true;
  if (block.type === "toolCall" && block.id && block.name) return true;
 }
 return false;
}

/** Only the values a rebuild would change; a stable turn must not re-render. */
function turnProcessSignature(process: TurnProcessView | undefined): string {
 if (!process) return "-";
 return `${process.turnId}:${process.isHead ? 1 : 0}:${process.open ? 1 : 0}:${process.label}:${process.note}`;
}

/** Whether any block of the message holds prose the reader could copy. */
function hasAnswerText(message: PiMessage): boolean {
 for (const block of messageBlocks(message)) {
  if (block.type !== "text") continue;
  if ((block.text ?? "").trim().length > 0) return true;
 }
 return false;
}
