# 执行计划：轮次级过程折叠

> 顺序即提交顺序。每一步都能单独跑测试；2/3/4 之间不要并行改同一文件。

## 0. 准备

- [ ] 读 `prd.md`、`design.md`、`.trellis/spec/webview/state-and-rendering.md`、
      `.trellis/spec/webview/streaming-and-scroll.md`。
- [ ] 基线：`node --test test/unit/webview/transcript.test.mjs test/unit/webview/transcript-controller.test.mjs test/unit/webview/transcript-sections.test.mjs`
      记录现有用例名（尤其 “a message folds its whole activity into one process handle”）。
- [ ] 在 `transcript.test.mjs` 里先写一条失败用例：一轮两条助手消息（各带思考与工具），
      断言只出现 1 个 `.activity-process` 表头、`data-turn-id` 相同、默认 `data-turn-open="false"`。

## 1. controller：轮次统计与开合状态

- [ ] `render()` 里按 `promptOrdinals()` 的同一套遍历生成 `turnId`（每条 entry 一个）。
- [ ] 用整份 `state.messages` 统计每轮：工具数、是否全为 `bash`、是否含 thinking，
      生成 `{ label, note }`；按 turnId 放进 `MessageRenderContext`。
- [ ] 新增 `Map<turnId, "open" | "closed">` 与 `turnProcessOpen(turnId)`：无记录时流式轮开、
      其它关。
- [ ] `TranscriptEntry.signature` 不再需要 thinking 展开位（见第 4 步），轮次 label 变化要进
      signature，否则计数刷新不重绘。

验证：`node --test test/unit/webview/transcript-controller.test.mjs`

## 2. renderer：表头只出现一次

- [ ] `assistantMessageSections()` 接收每轮的 `{ label, note, isHead }`；`isHead` 由
      controller 按「该轮第一个被渲染且有 activity 的消息」决定。
- [ ] 只有 `isHead` 的消息输出 `.activity-process` 表头；其余消息的 activity 段落不再带表头。
- [ ] 保持 `data-expandable="process"` 与现有文案结构（图标 + 标签 + 备注 + caret）。

验证：`node --test test/unit/webview/transcript.test.mjs`

## 3. dom / CSS：按轮开合

- [ ] `createMessageNode()` 写 `node.dataset.turnId` 与 `data-turn-open`。
- [ ] `toggleExpandable()` 的 `process` 分支改为调用 controller（记录选择 + 同步该轮所有
      已渲染 slot 的 `data-turn-open`），保留 `scheduleMeasure()`。
- [ ] 删除 `applyProcessState()` 的 per-slot 逻辑或改成读 controller。
- [ ] CSS：`.message-slot[data-turn-open="false"] .activity-timeline` 与表头所在行按现有
      `.process-open` 规则收合；caret 旋转改挂 `[data-turn-open="true"]`。

验证：`node --test test/unit/webview/transcript.test.mjs` + `npm run preview` 目测。

## 4. 思考默认展开

- [ ] renderer 不再输出 `data-expandable="thinking"`；有正文就渲染正文。
- [ ] 「思考过程」占位 + 点动画只在该段流式且无正文时出现。
- [ ] 删除 `isThinkingExpanded` / `setThinkingVisibility` / `thinkingSignature` 的展开位 /
      `applyExpandableState` 的 thinking 分支 / thinking 的 prune 逻辑。
- [ ] 更新 `transcript.test.mjs`、`transcript-sections.test.mjs` 里依赖折叠的断言。

验证：`npm run test:unit`

## 5. 收尾

- [ ] 全量 `npm run verify`（typecheck + 单测 + 可复现构建）。
- [ ] 手工验证：真实会话里一轮多步（至少 3 步、含思考）只显示 1 行；展开看得到思考正文；
      流式中展开、结束后收起、手动开合保持。
- [ ] `trellis-update-spec`：在 `webview/state-and-rendering.md` 补轮次级折叠契约，
      在 `streaming-and-scroll.md` 补「流式期间默认展开 / 结束后默认收起」。
- [ ] CHANGELOG `Unreleased` 增加一条；更新 `prd.md` 验收勾选。

## 回滚点

- 第 1 步做完即可回滚（只多出统计与状态，没有视觉变化）。
- 第 2–3 步一起回滚：表头归属和 CSS 必须同步，单独回滚会两头不讨好。
- 第 4 步独立：思考展开与轮次开合互不依赖。
