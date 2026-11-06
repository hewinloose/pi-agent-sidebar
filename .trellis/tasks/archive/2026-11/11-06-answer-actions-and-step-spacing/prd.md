# 回复动作只挂在轮次回答上，并收掉步骤旁白的多余空行

## Goal

一轮里真正的回答才带复制 / 分支 / 重新生成；中间步骤的旁白（如 `Trellis SessionStart ✓`）
既不出这三个按钮，也不再按独立正文排版，与相邻过程行之间不再空出好几行。

## Background

真实会话（`~/.pi/agent/sessions/--d--code-pi-agent-sidebar--/`）里，多份会话的第一条
assistant 消息内容是 `[thinking, text: "Trellis SessionStart ✓", toolCall]` —— 这句回执
不是独立消息，而是**该轮第一个步骤**里的一个 `text` block。

- [renderer.ts](../../../webview/transcript/renderer.ts) 用
  `hasAnswer = sections.some((section) => section.key.startsWith("content-"))` 决定是否挂
  动作，于是这个中间步骤被当成了「回答」，actions 挂在回执下面，和真正的回答重复；Copy
  复制的是回执本身。
- 该步骤的排版是 `思考 timeline → 正文 → 工具 timeline`，而 CSS 在正文与 timeline 之间
  各留一整行（`.assistant-text + .activity-timeline` / `.activity-timeline + .assistant-text`），
  `.assistant-text` 自己还有半行 padding，再叠加 `.messages` 的 slot 间距，看起来就是
  空了好几行。

## Requirements

### R1 动作归属

一轮里只有「该轮最后一条带正文的助手消息（回答）」渲染复制 / 分支 / 重新生成；中间步骤
一律不渲染这三个按钮。Copy 仍以消息 key 为游标，复制的是回答自己的正文。

### R2 步骤旁白的排版

非回答步骤的正文不再按正文块排版：与相邻过程行之间只保留半行，不再叠加整行 margin，也
不再有正文块自带的上边距。

### R3 既有行为不变

回答自身的动作、轮次折叠（`isHead` / 开合状态）、滚动锚定、渐进窗口都保持现状。

### R4 文案与无障碍

按钮的 title / aria / 顺序不变，不新增用户可见文案。

### R5 测试与 spec

单测覆盖「中间步骤无动作、最后回答有动作」与「步骤正文紧贴过程行」；
`.trellis/spec/webview/state-and-rendering.md` 的 §9 / §10 补上动作归属与步骤排版的约定。

## Out of scope

- 不改 `.pi/extensions/trellis` 要求的 SessionStart 回执本身，也不改系统提示。
- 不做 PI-Desktop 的过程时长、搜索定位、子代理拓扑。

## Acceptance Criteria

- [ ] 复现场景：`Trellis SessionStart ✓` 那一行下面没有复制 / 分支 / 重新生成；该轮最终回答
      下面有且只有一组。
- [ ] 该行与相邻过程行 / 回答之间不再出现整行空白（只保留半行）。
- [x] 只含工具或思考的步骤仍然没有动作。
- [x] 回答的 Copy 仍是回答正文，分支 / 重新生成仍作用于整轮。
- [x] `npm run verify` 通过；相关 webview spec 已同步。

## Notes

- 判断「回答」的口径：该轮中最后一条包含非空 `text` block 的 assistant 消息；流式消息也算。
- 无 turn 上下文直接渲染（renderer 单测）时默认视为回答，保持既有断言可用。

## 追加需求（首轮实装后复核）

- R6 折叠后的轮次必须只占一行：只含活动的步骤不得再贡献消息间距；步骤旁白与其
  后的回答之间不再留整行空白。
- R7 选中正文后点击过程表头必须能开合：只有当选区落在被点击元素内部时才忽略这次点击。

对应验收：

- [x] 折叠轮次里无正文的步骤不再占位（`data-turn-empty` + `display: none`）。
- [x] 步骤旁白后的回答取消一层间距，只留自己的半行 padding（`data-turn-after-step`）。
- [x] `Selection.containsNode` 判定选区，选中正文后能点开过程表头。
