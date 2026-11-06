# 把整轮的思考与工具调用折叠成一级，思考正文默认展开

## Goal

一轮回复里，思考和工具调用只占一个折叠入口；展开后直接看到思考正文和逐条命令，不再
出现「每个步骤一个折叠行 + 思考自己再折一层」。与 PI-Desktop 的轮次级过程折叠一致。

## Background

用户报告（会话 id `01a1b086-d659-71d3-ba43-c5c530ae28ae`）：同一条回复里依次看到

```
思考过程 / 1 次工具操作 / 1 个命令含思考 / 1 个命令 / 1 个命令 /
2 次工具操作 / 2 个命令含思考 / 1 次工具操作 / 1 个思考步骤
```

也就是：折叠粒度是「每条 pi 助手消息一个过程入口」，一轮里有几步就留几行入口；展开后
每段思考还被自己的「思考过程」占位再折一次。

现状来源：

- `webview/transcript/controller.ts` 把每条消息渲染成一个 `.message-slot`。
- `webview/transcript/renderer.ts` 的 `assistantMessageSections()` 只在该消息第一条
  activity 上放 `.activity-process` 表头（`data-process-head`），计数也只算这条消息。
- `webview/transcript/dom.ts` 的 `applyProcessState()` / `toggleExpandable()` 把开合状态
  存在单个 slot 上（`.process-open` + `data-process-choice`）。
- 思考段由 `thinkingGroups.ts` 合成，但每段仍是独立的 `data-expandable="thinking"`，
  默认收起。

PI-Desktop 的对照实现（`D:\code\PI-Desktop`）：

- `apps/desktop/src/features/chat/transcript/TurnProcess.tsx`：整轮所有过程放进一个
  `<section class="turn-process">`，`useAutomaticDisclosure(isActive, …)` 决定默认开合，
  表头是状态 + 时长 + 工具数。
- `AssistantTurn.tsx`：`TurnProcess` 只包过程段，答案留在折叠体之外。
- `apps/desktop/src/lib/thinking-visibility.ts`：思考显示是全局偏好、默认显示，且注释写明
  “never controls turn-process folding”。
- `disclosure.tsx`：关闭过程会一并关掉其下的分组，重新打开恢复用户先前展开的分组。

## Requirements

### R1 轮次级折叠

同一轮（一条用户提示之后的全部助手步骤）只出现一个过程折叠入口。表头给出整轮的工具有
关信息（工具数/命令数 + 含思考提示），沿用现有中文文案风格。

### R2 默认开合

整轮结束后默认收起；流式进行中默认展开（沿用现有「跟着流走」的行为）。用户手动开合后
以用户选择为准，且该选择按轮记住——重渲染、流式补丁、窗口滑动都不能把它丢掉。

### R3 思考默认不折叠

展开整轮后，各段思考正文直接可见，不再有「思考过程」二次折叠层。思考仍在流式生成、尚
无正文时保留可见的进行中提示。

### R4 答案与操作不受影响

助手答案、消息操作（复制 / 分支 / 重新生成）、工具卡片自身的展开、滚动锚定、渐进窗口
的行为都保持不变。

### R5 统计口径是整轮

表头计数与「含思考」提示覆盖该轮全部步骤，即使部分步骤已滑出渐进窗口。

### R6 一致性

文案为中文；测试与 `.trellis/spec/webview/` 里的相关约定同步更新。

## Out of scope

- 不改 pi 的 RPC、协议与持久化的会话文件。
- 不做 PI-Desktop 的过程时长（`处理中 · 12s` / `已处理 12s`）。
- 不做 PI-Desktop 的搜索定位、子代理拓扑展示。
- 不改命令行的样式与工具卡片内容。

## Acceptance Criteria

- [ ] 复现会话里同一轮的 9 条步骤只渲染 1 个折叠入口，默认收起，表头能看出有工具与思考。
- [ ] 展开后：思考正文直接可见（无「思考过程」二次折叠），工具/命令逐条可见且自身仍可展开。
- [ ] 流式中入口保持展开，结束后自动收起；用户手动开合结果跨重渲染保留。
- [x] 表头计数覆盖整轮，含滑出窗口的步骤。
- [x] 单测覆盖：轮次分组、默认开合、思考默认展开、整轮计数口径。
- [x] `npm run verify` 通过；相关 webview spec 已同步。

## Notes

- 复现数据来自用户报告，不是仓库内夹具；实现时用等价的 3+ 步含思考的消息序列做测试。
- 与 `11-05` 的差异：那次只做到「每条消息一个过程入口」，这次要提升到「每一轮一个入口」。
- 已在 11-04 归档任务的 “Follow-ups left out” 里记过这个缺口（activity 按消息而不是按轮）。
