# 审核跟进：只有步骤才取消回答前的间距

## Goal

收口 2026-11-06 十个提交的复核结论：修掉两处真实缺陷，其余判定为可接受并记录在案。

## Background

对 `13028bc..5b460b2`（10 个 commit）做完一次只读复核，结论三条：

1. `dom.ts` 的流式补丁只换 section，不刷新槽位的 `data-turn-*`，也不重建动作行。
2. `controller.ts` 的 `turnAnswerGaps()` 把同一轮里的**任何**前一条消息都当成「上一步」，
   于是每条轮次的第一条回答也被加了取消间距，贴着用户气泡（真实 bug）。
3. `test/helpers/transcript-harness.mjs` 的 `querySelectorAll()` 恒返回空列表，
   `setTurnProcess()` 同步槽位属性这条路径没有覆盖（测试缺口）。

## Requirements

- R1 `afterStep` 只统计同一轮中前一条 **assistant** 消息；用户提示不算步骤，回答与提示之间
  保留正常间距。
- R2 流式补丁发现消息的「有无正文」与槽位 `data-turn-empty` 不一致时，放弃原地补丁、交给
  上层整块重建，使槽位标记与动作行重新按当前上下文计算。
- R3 第 3 条为已知测试缺口：不新增 DOM 级 harness，记录在 Notes，避免同类「测试假装覆盖」
  的判断。

## Acceptance Criteria

- [x] `user → answer` 的 `afterStep` 为 `false`；`ack 步骤 → answer` 仍为 `true`（新增回归用例）。
- [x] 补丁入口在 `data-turn-empty` 不一致时返回 `undefined`，由 `renderStreamingFrame()` 回退整块渲染。
- [x] `npm run verify` 通过（446 用例）。

## Notes

- 复核代理第一版指令过宽（35 分钟、210 次工具调用未收敛），停掉后用收窄指令重跑并产出结论；
  本文记录的是收窄那一次的结论。
- 测试缺口（第三条）保留：`setTurnProcess()` 的槽位同步目前只有 CSS 契约测试与真机验证兜底。
  若要补，需要给 harness 造带 `dataset` 的假槽位并模拟 `data-turn-id`，属独立任务。
- 复核判定 clean 的面：折叠与渐进窗口/滚动锚定交互、流式回复的轮次归属、spec 与 CHANGELOG
  的说法、缩进风格。
