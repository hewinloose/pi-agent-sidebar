# 编辑器右键菜单只保留聚焦输入框

## Goal

选中代码后右键，第一层直接出现 **添加到 Pi Agent 对话框**；不再有
**Pi Agent** 子菜单，也不再有解释所选内容 / 解释此文件 / 重构所选内容 / 为所选内容
生成测试 / 解释所选内容中的问题这几项预设提示，以及随之失效的「用 Pi 修复」快速修复。

## Background

- `package.json` 贡献了一个 `piAgentSidebar.editorContext` 子菜单，`editor/context`
  里只有这一条 `{"submenu": "piAgentSidebar.editorContext", "group": "navigation@100"}`。
  子菜单内依次是 `focusInput`（`editorHasSelection`）、四个选区预设、以及
  `explainFile`（无 `when`，始终可见）。
- 子菜单里的预设命令由 `src/extension.ts` 的 `registerPreset()` 注册，
  提示词与引用捕获在 `PiViewProvider.runPresetPrompt()` + `PRESET_INSTRUCTIONS`。
- `PiFixCodeActionProvider`（同一文件）在诊断上挂「用 Pi 修复」快速修复，
  实际执行的就是 `piAgentSidebar.explainDiagnostics`；删掉该命令必须同时删掉这个
  CodeAction，否则快速修复会指向一个不存在的命令。
- 本次是收窄入口：右键只需要“把选区带进输入框”，预设提示改为由用户在输入框里
  自己输入。

## Requirements

### 1. 右键菜单扁平化

- `contributes.menus["editor/context"]` 改为直接贡献
  `{"command": "piAgentSidebar.focusInput", "when": "editorHasSelection", "group": "navigation@100"}`，
  组与位置沿用原 `Pi Agent` 子菜单的 `navigation@100`。
- 删除 `contributes.submenus` 整段（`piAgentSidebar.editorContext`）与
  `contributes.menus["piAgentSidebar.editorContext"]`。
- 未选中文本时右键不出现任何 Pi Agent 项（与原 `focusInput` 在子菜单内的可见条件一致）；
  快捷键 `ctrl+escape` / `cmd+escape` 行为不变。

### 2. 删除五个预设命令及其实现

- `contributes.commands` 删除 `explainSelection`、`explainFile`、`refactorSelection`、
  `generateTests`、`explainDiagnostics`；保留 `focusInput` 及其标题
  `添加到 Pi Agent 对话框`。
- `src/extension.ts` 删除 `registerPreset()`、五个预设的注册、`PresetPromptKind`
  导入、`PiFixCodeActionProvider` 类与 `registerCodeActionsProvider` 调用。
- `src/provider/piViewProvider.ts` 删除 `PresetPromptKind`、`PRESET_INSTRUCTIONS`、
  `runPresetPrompt()`，并清理因此变成未使用的导入与常量
  （如 `shouldSnapshotFileReference`、只被预设引用的 `MAX_TOTAL_COMPOSER_REFERENCE_BYTES`）。
- `focusInputWithSelection()`、`ComposerReferenceStore` 的选区捕获保持原样。

### 3. 测试

- `test/integration/manifest.test.mjs`：`expectedCommands` 去掉五个预设；
  改为锁定 `editor/context` 只有 `focusInput` 一条、`contributes.submenus` 不存在、
  `menus["piAgentSidebar.editorContext"]` 不存在；现有快捷键断言保持不变。

### 4. 文档

- `README.md` / `README.zh-CN.md` 的“编辑器集成”段落：改为“右键 添加到 Pi Agent 对话框
  ”，删掉子菜单描述与「Fix with Pi / 用 Pi 修复」；命令表删除五个预设
  命令行。
- `CHANGELOG.md` 的 `Unreleased` 增加一条本次变更记录。
- 若 `.trellis/spec/` 中有描述子菜单或预设命令的段落，一并修正（扫描后再判断）。

## Out of scope

- 不改 `focusInputWithSelection()` 的选区捕获、符号补全、引用同步逻辑。
- 不改快捷键、`explorer/context` 菜单、`editor/title` 图标入口。
- 不删除 pi 侧任何能力，也不引入新的预设提示 / i18n 框架。

## Acceptance Criteria

- [x] `package.json` 中不再有 `submenus` 段，`editor/context` 只有
      `piAgentSidebar.focusInput`（`editorHasSelection`，`navigation@100`）。
- [x] 选中代码右键：第一层直接是「添加到 Pi Agent 对话框」，点击后侧栏打开、
      输入框聚焦、选区引用插入，与改动前的该项行为一致。
- [x] 未选中代码时右键没有 Pi Agent 项；`Ctrl+Esc` / `Cmd+Esc` 仍能聚焦输入框。
- [x] 五个预设命令不再出现在命令面板，诊断上不再有「用 Pi 修复」快速修复。
- [x] `test/integration/manifest.test.mjs` 的断言与新的清单一致。
- [x] `npm run verify` 通过（typecheck + test:unit + check:generated）。

## Notes

- 删除 `explainDiagnostics` 会连带失去「用 Pi 修复」：这是用户明确要求的结果，
  需要写进 CHANGELOG，避免以后被当成回归。
- 这是一次轻量任务，PRD 即为规划产物；不改动协议层，不涉及 webview。
- 右键行为由 `editor/context` 清单 + 未改动的 `focusInputWithSelection()` 锁定，并由
  `manifest.test.mjs` 固定；本次没有在真实 VS Code 窗口里手动点击验证。
- 2026-11-11 追加：按用户要求把该命令的显示名从 `Pi Agent: 聚焦输入框（含所选内容）`
  改为 `添加到 Pi Agent 对话框`，因此命令面板与快捷键 UI 里不再带 `Pi Agent:` 前缀。
