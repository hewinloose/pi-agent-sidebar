# Pi Agent Sidebar 插件功能修改

## Goal

调整 Pi Agent Sidebar 的入口与文案：把运行时状态从窗口底栏移进侧栏，
用编辑器标题栏的插件图标作为侧栏入口，并把消息头部与输入区的操作说明
统一改为中文。

## Requirements

- 移除窗口底栏的运行阶段条目，改为侧栏视图标题栏的阶段徽标
  （启动中 / 运行中 / 已停止 / 出错），模型、思考等级与上下文放进 tooltip。
- 编辑器标题栏（"向右拆分编辑器" 那一排）显示插件自己的 `assets/pi.svg`，
  点击打开 Pi Agent 侧栏。
- 首次点击（本窗口尚未启动过运行时）启动 pi 并新建会话；此后点击只展开侧栏。
  首次启动不得恢复上次会话，否则旧对话会先渲染再被替换。
- "新建会话" 从侧栏 `view/title` 移到消息头部，紧跟 "会话历史" 右侧。
- 所有可点击控件的说明改为中文，包括命令面板条目、弹窗按钮、
  Enter / Alt+Enter 提示（steer → 引导当前回复，follow-up → 追加消息）。
- 新增 `piAgentSidebar.newTrellisTask` 命令：通过 `.trellis/scripts/task.py create`
  建任务目录并把需求交给 pi 用 `/trellis-brainstorm` 细化。

## Acceptance Criteria

- [x] 底栏不再出现运行阶段条目；侧栏标题栏徽标随阶段变化。
- [x] 编辑器标题栏出现 Pi 图标，点击打开侧栏，首次点击落到全新会话且旧对话不闪现。
- [x] "新建会话" 位于 "会话历史" 右侧，功能不变。
- [x] 可点击控件说明为中文，命令面板条目为中文。
- [x] `npm run verify` 通过（typecheck + 单测 + 产物可复现）。
- [x] 清单测试锁定：`editor/title` 仅含打开命令、`view/title` 不存在、
      按钮顺序与中文标签。

## Notes

- 插件仍只消费 pi 的公开 RPC；Trellis 任务目录布局交给 Trellis 自己的脚本，
  插件不自行拼装任务文件。
- 侧栏容器 `viewsContainers` 未改动：Pi 图标缺失属于次侧边栏被关闭，
  不是按钮位置问题。
