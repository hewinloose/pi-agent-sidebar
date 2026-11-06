# 设计：轮次级过程折叠

## 1. 现状结构

- `webview/transcript/controller.ts` 的 `render()` 把每条可渲染消息映射成一个
  `TranscriptEntry`（key = message key），交给 `transcriptView.update(entries)`。
- `webview/transcript/dom.ts` 的 `createMessageNode()` 为每条 entry 建一个
  `.message-slot`；流式消息走 `patchStreamingMessage()` 原地替换内容。
- `webview/transcript/renderer.ts` 的 `assistantMessageSections()` 逐条消息生成
  activity 段落，只有**该消息**第一条 activity 带 `.activity-process` 表头
  （`data-process-head`）；`processLabel` / `processNote` 的计数也只算这条消息。
- 开合状态在 slot 上：`.process-open` + `data-process-choice`，由
  `dom.ts:applyProcessState()`（默认：流式开、结束后关）与 `toggleExpandable()` 维护。
- 思考：`thinkingGroups.ts` 把连续的 `thinking` block 合并成一段，但每段仍是独立的
  `data-expandable="thinking"`，默认不展开（`isThinkingExpanded(key)` 无记录即 false）。
- 轮次归属已经存在：`controller.promptOrdinals()` 把每条消息映射到开启它的用户消息序号，
  窗口外的前缀用 `omittedPromptCount` 对齐。

## 2. 选择：轮次状态 + 单一表头，slot 结构不变

不合并消息、不新增包裹节点，只把「过程开合」的粒度和「表头归属」从消息提升到轮次：

1. **轮次标识**：沿用 prompt ordinal 作为 turn id。`render()` 为每条 entry 计算
   `turnId`，随 `MessageRenderContext` 传给 renderer / dom；`createMessageNode()`
   写到 `node.dataset.turnId`。
2. **整轮统计**：controller 用整份 `state.messages`（不是窗口）统计每轮的
   `toolCount`、`allCommands`、`hasThinking`、`stepCount`，生成与现有文案同形的
   `processLabel` / `processNote`，按 turnId 放进 context。窗口切掉前置步骤时计数仍然
   是整轮口径（R5）。
3. **单一表头**：表头只渲染在该轮**第一个被渲染且带 activity** 的 slot 上；其余 slot
   只渲染各自的 activity 条目，不带表头。若轮次开头被渐进窗口切掉，表头落到第一个可见
   步骤上，计数仍是整轮。
4. **开合状态**：从 slot 移到 controller：`Map<turnId, "open" | "closed">`。默认值由
   「该轮是否正在流式」决定（流式开、结束关），用户点击后写入 map 并优先于默认值。
   重渲染、流式补丁、窗口滑动都读同一份 map，因此选择不会丢（R2）。
5. **落地方式**：slot 带 `data-turn-open="true|false"`；CSS 复用现有 `.process-open`
   规则，选择器改成按 `data-turn-open` 收合 `.activity-timeline` 与表头所在行。
6. **点击**：`toggleExpandable()` 把 `process` 分支改成「改 controller 的轮次状态 →
   对该 turnId 的所有已渲染 slot 同步 class → `scheduleMeasure()`」，不再只改当前 slot。

## 3. 思考（R3）

- 删除块级折叠：不再输出 `data-expandable="thinking"`，思考段有正文就直接渲染正文。
- 「思考过程」+ 点动画只在**该段正在流式生成且还没有正文**时显示，作为进行中提示。
- 连带删除：`controller.isThinkingExpanded()` / `setThinkingVisibility()`、
  `renderer` 的 `isThinkingExpanded` 参数、`thinkingSignature()` 里的 0/1 位、
  `applyExpandableState()` 对 thinking 的处理、以及 thinking 相关的 `prune` 清理。
- 这与 PI-Desktop 一致：那边只有全局 `showThinking` 偏好，没有块级折叠，且注释明确它
  不控制过程折叠。

## 4. 被否掉的替代方案

| 方案 | 为什么不做 |
|------|------------|
| 把一轮的助手消息合并成一个 slot（照搬 `AssistantTurn.tsx` 的行结构） | 会同时打断流式原地补丁、每条消息的操作栏、渐进窗口与滚动锚定；收益只是结构更纯 |
| 新增一个包住多个 slot 的容器节点 | 仍要跨 slot 状态，还多一层 DOM 与更新路径，和方案 2 相比只增加风险 |
| 只改 CSS `:has()` 把后续 slot 藏起来 | 表头计数仍需跨消息统计，开合状态仍需跨 slot，CSS 单独做不到 |

## 5. 影响面

- `webview/transcript/controller.ts`：轮次统计、turn 开合状态、context 扩展。
- `webview/transcript/renderer.ts`：表头归属与计数改为外部传入；删除思考块级折叠。
- `webview/transcript/dom.ts`：`data-turn-id` / `data-turn-open` 写入、点击路由、
  删除 thinking 开合的读写。
- `webview/styles/transcript.css`：收合选择器从 `.message-slot:not(.process-open)` 换成
  `[data-turn-open="false"]`；删除 `.thinking-collapsed` 的常驻显示。
- 测试：`transcript.test.mjs`、`transcript-controller.test.mjs`、
  `transcript-sections.test.mjs`，新增轮次场景。
- spec：`webview/state-and-rendering.md`（渲染契约）与 `webview/streaming-and-scroll.md`
  （流式期间的开合默认值）需要补一条轮次级折叠的约定。

## 6. 风险

- 轮次归属依赖消息数组顺序；`withLiveReply()` 插入的流式回复必须落在正确 turn 里
  （`promptOrdinals()` 已经能处理，沿用即可）。
- 渐进窗口把一轮切成两半时，表头会出现在「第一个可见步骤」而不是真正的第一步；计数
  仍是整轮，视觉上可接受，但测试要明确这一条。
- 删除块级思考折叠会减少一个交互，需确认没有别的入口依赖 `data-thinking-key`。
