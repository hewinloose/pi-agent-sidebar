# 执行计划：动作归属与步骤旁白排版

## 1. controller：标出每轮的回答

- [ ] `MessageRenderContext` 增加 `answerKeys: ReadonlySet<string>`。
- [ ] 在 `render()` 里按渲染顺序（`visible`，已含流式回复）扫一遍：每个 turn 记下最后一条
      含非空 `text` block 的 assistant 消息，作为该轮回答。
- [ ] 只含工具/思考的步骤不会进入集合；同一条消息不会既算步骤又算回答。
- [ ] 集合随时放进 context 与 `turnProcess` 一起更新。

验证：`node --test test/unit/webview/transcript-controller.test.mjs`

## 2. renderer：只有回答挂动作

- [ ] `messageHtml(..., promptOrdinal?, turnProcess?, isAnswer = true)` 透传到
      `assistantMessageHtml`。
- [ ] `hasAnswer && isAnswer` 才渲染 actions；无 turn 上下文时默认 `true`。
- [ ] 更新 `renderer.ts` 里解释「步骤不出动作」的注释，说明判定现在按轮次。

验证：`node --test test/unit/webview/transcript.test.mjs`

## 3. dom / CSS：步骤旁白紧贴过程行

- [ ] `createMessageNode()` 在 slot 上写 `data-turn-step="true|false"`（来自 `answerKeys`）。
- [ ] CSS 增加：
      `.message-slot[data-turn-step="true"] .assistant-text { padding-top: 0; }`
      以及 `.assistant-text + .activity-timeline` / `.activity-timeline + .assistant-text`
      在该选择器下改为 `margin-top: var(--pi-line-half)`。
- [ ] 不动回答消息（`data-turn-step="false"`）的现有间距。

验证：`node --test test/unit/webview/transcript-sections.test.mjs` + `npm run preview` 目测。

## 4. 收尾

- [ ] 新用例：中间步骤无 actions、回答有 actions、`data-turn-step` 与 CSS 规则存在。
- [ ] `npm run verify`。
- [ ] spec：`webview/state-and-rendering.md` §9 补「动作只挂回答」，§10 补「步骤旁白不按正文
      排版」；CHANGELOG `Unreleased` 加一条；勾选 PRD 验收项。

## 回滚点

- 第 1 步只多出集合，无视觉变化，可单独回滚。
- 第 2、3 步分别对应两个现象，可独立回滚（动作与间距互不依赖）。
