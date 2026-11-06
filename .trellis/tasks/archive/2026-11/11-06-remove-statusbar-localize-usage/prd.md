# 移除底栏 Pi Agent 状态项并中文化用量说明

## Goal

窗口底栏不再出现 Pi Agent 的运行阶段条目；点开上下文用量弹层时，所有说明文字都是中文。

## Background

- `src/extension.ts` 用 `createStatusBarItem("piAgentSidebar.chatView", …)` 建了一个状态项，
  `PiViewProvider.bindViewTitle/updateViewTitle` 往里面写图标（sparkle / 转圈）和 tooltip
  （`Pi Agent` / `pi 已就绪。` / `模型：…` / `思考等级：high`）。依据 `@types/vscode`
  的文档，`createStatusBarItem(id, …)` 只要求 id 在本扩展内唯一，没有“放进视图标题栏”
  的语义，于是这个条目落在了窗口底栏。
- 用量弹层由 `webview/ui/runtimeRenderer.ts` 的 `usageRows()` 生成，标签仍是英文
  （Context / Input / Output / Cache read / Cache write / Total tokens / Cost /
  Messages / Tool calls），占位文案也是英文。

## Requirements

### 1. 移除底栏 Pi Agent 状态项

- 不再创建、绑定、释放该状态项：`src/extension.ts` 去掉 `createStatusBarItem` /
  `bindViewTitle` / `viewTitleItem`；`PiViewProvider` 去掉 `bindViewTitle`、
  `updateViewTitle`、`viewPhase`、`viewTitleItem`、`viewTitleState` 以及 `post()` 和
  `agent_start` 里的驱动调用。
- runtime 阶段信息继续由侧栏头部承担（`webview/ui/headerRenderer.ts` 的
  “pi 正在工作 / pi 已就绪”），不新增任何窗口级替代条目。
- 同步修正 `test/integration/manifest.test.mjs` 里锁定 `createStatusBarItem(...)` 与
  `item.show()` 的断言，改为锁定“扩展源码不再创建状态栏条目”。

### 2. 用量弹层中文化

- 标签：Context → 上下文，Input → 输入，Output → 输出，Cache read → 缓存读取，
  Cache write → 缓存写入，Total tokens → 总 token，Cost → 费用，Messages → 消息，
  Tool calls → 工具调用。
- 占位文案：`Usage` / `Not reported by pi yet` → `用量` / `pi 暂未上报`；
  `Unavailable until the next response` → `下次回复后可用`。
- 数值格式保持不变：token 计数、百分比、货币继续走 `formatTokenCount` / `formatCost`
  与 `timeContext.locale`，不新增格式化逻辑。
- 同步更新 `test/unit/webview/region-renderers.test.mjs` 中 `usageRows` 的行断言。

## Out of scope

- 不改侧栏头部、编辑器标题栏入口、模型/思考等级控件。
- 不改 pi 的 RPC、用量数据来源与统计口径。
- 不引入 i18n 框架：仓库现状是直接写死中文文案。

## Acceptance Criteria

- [x] 窗口底栏不再出现 Pi 状态项；`src/extension.ts` 与 `src/provider/piViewProvider.ts`
      不再引用 `createStatusBarItem` / `bindViewTitle`。
- [x] 侧栏头部的连接状态文案不变，仍随 runtime 阶段更新。
- [x] 用量弹层（按钮标题 `会话用量详情`）标签与占位文案全部为中文，数值格式与改动前一致。
- [x] `region-renderers.test.mjs` 断言中文化后的行；`manifest.test.mjs` 锁定“不创建状态栏条目”。
- [x] `npm run verify` 通过（typecheck + test:unit + check:generated）。
- [x] `.trellis/spec/host/webview-boundary.md` 中“状态项只出现在视图标题栏”的错误说法被修正。

## Notes

- 这次是纠偏而非功能回退：底栏条目当初的目标是“只在侧栏存在时显示阶段”，实际并没有
  这样的 API 语义；阶段信息在侧栏头部已经可见，删除条目不丢信息。
- 若后续确实想在视图标题栏放徽标，需要走 `view/title` 菜单贡献或 Webview 内部渲染，
  不在本任务范围内。
