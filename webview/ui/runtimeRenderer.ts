import type { UiState } from "../app/state.js";
import type { StreamingUsageTracker } from "../streamUsage.js";
import { formatCost, formatTokenCount } from "../transcript/messageTime.js";
import { positionPopupAbove } from "./popupPosition.js";

interface RuntimeElements {
 app: HTMLElement;
 queueStatus: HTMLElement;
 widgetArea: HTMLElement;
 runtimeMeta: HTMLButtonElement;
 usagePanel: HTMLElement;
}
export interface RuntimeRendererOptions {
 elements: RuntimeElements;
 state: Pick<UiState, "queue" | "stats" | "timeContext">;
 usage: Pick<StreamingUsageTracker, "displayStats">;
 statuses: ReadonlyMap<string, string>;
 widgets: ReadonlyMap<string, string[]>;
}

/** Renders pi-reported queue, widget and usage state, including the usage popup. */
export function createRuntimeRenderer(options: RuntimeRendererOptions) {
 const { elements, state: ui, usage } = options;
 function renderQueue(): void {
  const parts: string[] = [];
  if (ui.queue.steering.length > 0) parts.push(`${ui.queue.steering.length} steering`);
  if (ui.queue.followUp.length > 0) parts.push(`${ui.queue.followUp.length} follow-up`);
  parts.push(...options.statuses.values());
  const text = parts.join(" · ");
  elements.queueStatus.hidden = text.length === 0;
  elements.queueStatus.textContent = text;
  elements.queueStatus.title = text;
 }
 function renderWidgets(): void {
  const lines = [...options.widgets.values()].flat();
  elements.widgetArea.hidden = lines.length === 0;
  elements.widgetArea.textContent = lines.join("\n");
 }
 function renderRuntimeMeta(): void {
  const locale = ui.timeContext.locale || undefined;
  const parts: string[] = [];
  const stats = usage.displayStats(ui.stats);
  const context = stats?.contextUsage?.percent;
  if (typeof context === "number") parts.push(`上下文 ${Math.round(context)}%`);
  if (typeof stats?.cost === "number" && stats.cost > 0) parts.push(formatCost(stats.cost, locale));
  elements.runtimeMeta.hidden = !stats;
  elements.runtimeMeta.textContent = parts.join(" \u00b7 ") || "用量";
  elements.runtimeMeta.title = "会话用量详情";
  if (elements.runtimeMeta.hidden) dismissUsagePanel();
  else if (!elements.usagePanel.hidden) renderUsagePanel();
 }
 function renderUsagePanel(): void {
  const rows = usageRows(usage.displayStats(ui.stats), ui.timeContext.locale || undefined);
  const list = document.createElement("dl");
  list.className = "usage-list";
  for (const [label, value] of rows) {
   const term = document.createElement("dt");
   term.textContent = label;
   const detail = document.createElement("dd");
   detail.textContent = value;
   list.append(term, detail);
  }
  elements.usagePanel.replaceChildren(list);
 }
 function toggleUsagePanel(): void {
  if (!elements.usagePanel.hidden) { dismissUsagePanel(); return; }
  renderUsagePanel();
  elements.usagePanel.hidden = false;
  elements.runtimeMeta.setAttribute("aria-expanded", "true");
  positionPopupAbove({ container: elements.app, popup: elements.usagePanel, anchor: elements.runtimeMeta });
 }
 function dismissUsagePanel(): void {
  if (elements.usagePanel.hidden) return;
  elements.usagePanel.hidden = true;
  elements.runtimeMeta.setAttribute("aria-expanded", "false");
 }
 return { renderQueue, renderWidgets, renderRuntimeMeta, toggleUsagePanel, dismissUsagePanel };
}

export function usageRows(stats: UiState["stats"], locale?: string): Array<[string, string]> {
 if (!stats) return [["用量", "pi 暂未上报"]];
 const rows: Array<[string, string]> = [];
 const usage = stats.contextUsage;
 if (usage) rows.push(["上下文", usage.tokens === null || typeof usage.percent !== "number" ? "下次回复后可用" : `${formatTokenCount(usage.tokens, locale)} / ${formatTokenCount(usage.contextWindow, locale)} (${Math.round(usage.percent)}%)`]);
 const tokens = stats.tokens;
 if (tokens) rows.push(
  ["输入", formatTokenCount(tokens.input, locale)], ["输出", formatTokenCount(tokens.output, locale)],
  ["缓存读取", formatTokenCount(tokens.cacheRead, locale)], ["缓存写入", formatTokenCount(tokens.cacheWrite, locale)], ["总 token", formatTokenCount(tokens.total, locale)],
 );
 if (typeof stats.cost === "number") rows.push(["费用", formatCost(stats.cost, locale)]);
 if (typeof stats.totalMessages === "number") rows.push(["消息", formatTokenCount(stats.totalMessages, locale)]);
 if (typeof stats.toolCalls === "number") rows.push(["工具调用", formatTokenCount(stats.toolCalls, locale)]);
 return rows;
}
