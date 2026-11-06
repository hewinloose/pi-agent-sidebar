# 轮次折叠的三处体验修正

## Goal

收口安装后反馈的三处体验问题：折叠入口在步骤之间抖动、动作行出现在未完成的回答上、bash 步骤
被简化成「运行命令」。

## Background

- 上一版 `open` 的默认值只看 `state.streamingMessage`。pi 每一步都会 settle，步骤之间没有流式
  消息，于是入口在每步边界收起又打开。
- 「回答」原先定义为「该轮最后一条有正文的消息」。流式中的消息与 `stopReason: "toolUse"` 的
  步骤都被算了进去，导致思考阶段第一条命令挂在动作行、回答流式期间只挂一个 Copy。
- bash 折叠时用 `运行命令` 标签替换命令本身，两步 shell 无法从标题区分。

## Requirements

- R1 入口默认开合按「这一轮是否还在跑」判断：最后一条 assistant 消息 `stopReason: "toolUse"`
  即为仍在跑；流式消息落在该轮亦视为在跑。最终回答落地后收起，用户手动选择仍优先。
- R2 动作行（复制 / 分支 / 重新生成）只挂在该轮**已完成**的回答上：流式消息与 `toolUse`
  步骤都不算回答。
- R3 bash 步骤始终显示 `$ <command>`，不再输出 `运行命令` 标签；折叠态按列宽省略，`title`
  保留完整命令。
- R4 `data-turn-step` 只标记 `toolUse` 步骤，流式中的回答仍按正文排版。

## Acceptance Criteria

- [x] 多步骤轮次从第一步到最终回答保持展开，回答落地后收起（新增用例覆盖 `toolUse` 与 `stop`）。
- [x] 回执步骤（`toolUse`）单独存在时 `isAnswer=false`；回答流式中 `isAnswer=false`，settle 后为 `true`。
- [x] bash 行输出 `$ …` 且不含 `tool-command-name`；CSS 无「折叠隐藏命令」规则。
- [x] `npm run verify` 通过（448 用例，445 pass / 3 skipped）。

## Notes

- 三处改动同源：都来自「轮次/步骤/回答」三种状态的判定口径，集中在 `TranscriptController` 与
  `dom.ts` 的标记上；R3 是渲染层与 CSS 的独立收敛。
- 折叠默认值的可持久信号是 `stopReason === "toolUse"`（会话数据已确认：中间步骤 toolUse、
  最终回答 stop），不依赖瞬时流式状态。
