# Pi Agent for VS Code

[English](https://github.com/dairycode/pi-agent-sidebar/blob/main/README.md) · [简体中文](https://github.com/dairycode/pi-agent-sidebar/blob/main/README.zh-CN.md)

一个把 [pi](https://pi.dev) 放进 VS Code 辅助侧边栏的客户端，建立在 pi 的公开 RPC 协议之上。

这个扩展刻意做得很薄：它在扩展宿主里以 RPC 模式启动你自己已经装好的 `pi`，然后渲染 pi 报告的一切。会话状态、工具、diff、历史记录、斜杠命令都属于 pi，扩展只负责侧边栏这一层。

源码：<https://github.com/dairycode/pi-agent-sidebar>

## 预览

![Pi Agent 侧边栏在 VS Code 辅助侧边栏中的样子](https://origin.picgo.net/2026/08/30/snapshot65fc55d47c1fd643.png)

## 环境要求

| 要求 | 说明 |
| --- | --- |
| VS Code 1.129 或更新 | 视图位于**辅助侧边栏**（secondary side bar） |
| `pi` 0.81.0 或更新 | 需要已安装并已登录 |
| 一个受信任的工作区 | 未受信任的工作区中扩展保持禁用 |

请先安装并登录 pi，没有它扩展无法工作：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
/login
```

## 安装与打开

1. 在命令面板里执行 **Pi Agent: 打开**，或点击编辑器标题栏上的 pi 图标。
2. 视图在辅助侧边栏中打开。想让它待在主侧边栏，用 VS Code 自带的 *移动视图* 命令即可。
3. 直接输入即可。模型、工具、审批流程都和 pi CLI 中完全一致——因为它运行的就是 pi CLI。

## 功能

### 对话

- **流式转写**：pi 的正文、思考过程与工具执行实时渲染，配色跟随当前 VS Code 主题。
- **回合折叠**：一个回合的思考与工具调用折叠成一行，标出该回合的工具数量；回合进行中自动展开，结束后自动收起（除非你手动拨动过）。答案结束后单独保留 Copy / Branch / Regenerate 一行。
- **工具时间线带 diff**：文件编辑按新增、删除、上下文行渲染；回复里的 `path/file.ts:42` 可直接跳到该文件的对应行。
- **图表**：pi 消息里的 `mermaid` 代码块会画成随主题着色的图表，源码一键可查。图形库随扩展打包，只有真正出现图表时才解析；你自己消息里的代码块仍然保持源码形态。
- **原生对话框**：pi 扩展的提问和可信域名确认走 VS Code 原生 UI，而不是 Webview 里的仿制品。

### 会话

- 持久化历史记录，支持搜索、切换、重命名、删除和新建。
- 重新加载 VS Code 后，自动恢复该工作区上次使用的会话。
- 任意会话可导出为独立 HTML 文件。
- 会话存放在 pi 自己的位置（默认 `~/.pi/agent/sessions`），所以 CLI 和侧边栏看到的是同一份历史；`piAgentSidebar.sessionDirectory` 会让两边一起搬家。

### 输入框

- **行内引用**：插入 `@path` / `@path#line` 形式的可点击引用，`Cmd`/`Ctrl`-点击或 `F12` 跳回源码。
- **文件提及**：输入 `@` 按层浏览工作区，选文件夹进入，选中文件后 `Enter` 插入。文件夹引用只传目录路径，让 pi 按需去看。
- **附件**：输入框的 `+` 按钮把文件或图片作为 chip 附上；粘贴的 PNG、JPEG、GIF、WebP 走同一条流程。
- **斜杠命令**：输入 `/` 浏览 pi 的扩展命令、prompt 模板和 skill，按来源分组，边输入边过滤。
- **排队与中断**：pi 工作中可以继续排队后续 prompt，也可以终止当前运行。供应商侧的瞬时错误（过载、限流、5xx、流中断）会自动重试。
- **模型与思考等级**：在输入框的主题化选择器里切换。

### 编辑器集成

- 右键 **Pi Agent** 子菜单：解释所选内容、把所选内容加进输入框（不带预设指令）、重构、生成测试、解释报告的问题、解释整个文件。
- 光标所在诊断上提供 **Fix with Pi** 快速修复。
- 资源管理器的 **Pi Agent: 将文件或文件夹添加到输入**，或按住 `Shift` 把文件拖到侧边栏任意位置，插入同一种行内引用。

### 命令

| 命令 | 作用 |
| --- | --- |
| Pi Agent: 打开 | 显示侧边栏 |
| Pi Agent: 聚焦输入框（含所选内容） | 打开、聚焦输入框，并插入选区引用 |
| Pi Agent: 新建会话 | 开一个新会话 |
| Pi Agent: 新建 Trellis 任务 | 工作区存在 Trellis 结构时，通过 `.trellis/scripts/task.py` 创建任务 |
| Pi Agent: 重命名会话 | 重命名当前会话 |
| Pi Agent: 导出会话为 HTML | 把当前会话导出成独立页面 |
| Pi Agent: 解释所选内容 / 解释此文件 / 重构所选内容 / 为所选内容生成测试 / 解释所选内容中的问题 | 针对选区或文件的预设提示 |
| Pi Agent: 将文件或文件夹添加到输入 | 把资源管理器中的选择加进输入框 |
| Pi Agent: 重启运行时 | 结束并重新拉起 pi 进程 |
| Pi Agent: 查看日志 | 打开扩展的输出通道 |

## 快捷键

在编辑器里选中代码，按 `Cmd+Esc`（macOS）或 `Ctrl+Esc`（Windows / Linux）。侧边栏打开、输入框获得焦点，并在光标处插入 `@src/file.ts#10-14` 这样的行内引用，同时把选中的原文作为代码上下文一并带上。删掉引用即解除绑定；`Cmd`/`Ctrl`-点击它或在其中按 `F12` 可跳回。没有选中内容时，这个快捷键只负责聚焦输入框。

其他 AI 扩展可能占用同一组合键——冲突时在 VS Code 的键盘快捷方式里重新绑定 **Pi Agent: 聚焦输入框（含所选内容）**。

## 配置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| `piAgentSidebar.binaryPath` | `pi` | pi 可执行文件路径。`pi` 不在 `PATH` 上时填绝对路径。 |
| `piAgentSidebar.additionalArguments` | `[]` | 在进入 RPC 模式前传给 pi 的额外参数。会话与运行模式相关参数由扩展管理。 |
| `piAgentSidebar.sessionDirectory` | `""` | 会话存储目录（`--session-dir`）。可以是绝对路径，或相对工作区目录的路径。留空表示使用 pi 的默认位置。 |
| `piAgentSidebar.trustProjectResources` | `true` | 工作区受信任后，加载项目内的 pi 设置、扩展、skill 和 prompt。 |
| `piAgentSidebar.restoreSession` | `true` | 重新加载后恢复本工作区上次的会话。 |
| `piAgentSidebar.autoRetry` | `true` | 自动重试供应商侧的瞬时错误。 |

`binaryPath`、`additionalArguments`、`sessionDirectory` 是机器级设置，其余可在工作区级覆盖。`autoRetry` 直接转发给 pi 自己的 `set_auto_retry` RPC，重试逻辑不由扩展实现。

## 常见问题

**VS Code 找不到 `pi`。** 把 `piAgentSidebar.binaryPath` 设为绝对路径，例如 `/opt/homebrew/bin/pi` 或 `C:\Users\you\AppData\Roaming\npm\pi.cmd`。

**Windows。** npm 把 `pi` 装成 `.cmd` shim，无法直接启动。`binaryPath` 保持默认时，扩展先尝试 `pi`，失败后自动改用 `node.exe` 并把它全局安装的入口脚本作为第一个参数（脚本取自该包自己的 `bin` 字段）。把 `binaryPath` 设成 `pi` 以外的值即可覆盖这个兜底行为。

**视图一直是禁用的。** 说明工作区未受信任。pi 能以你的权限读写、执行文件，所以扩展在受限模式下拒绝启动。

**提示 "older than the tested minimum"。** 装着的 pi 低于 0.81.0。请升级 pi——RPC 行为可能已经变了。

**终端里 pi 正常，侧边栏没反应。** 打开 **Pi Agent: 查看日志**，看运行时那行记录的究竟是哪个二进制、哪个版本。

## 安全模型

扩展不对 pi 做沙箱。pi 默认的编码工具能以扩展宿主的权限读取、修改、执行文件。现有的约束是：

- 未受信任的工作区中视图禁用，并且只有在 VS Code 确认信任之后，才为项目内的 pi 资源传 `--approve`。
- 配置的二进制不经过 shell 启动。
- 转写内容里的 Markdown 在进入 DOM 之前会被消毒；Webview 的 CSP 只放行带文档 nonce 的脚本。Mermaid 是 CSP 唯一的额外开口：插入的 SVG 自带样式，因此 `style-src` 允许内联样式，同时插入前会剥掉 SVG 里的脚本、事件处理属性和可执行的 `href`。

会话文件归 pi 管，默认在 `~/.pi/agent/sessions` 下。它们可能包含源码、工具输出和其他敏感对话数据——请像对待 shell 历史一样对待它们。

扩展本身不收集遥测，也不发起自己的网络请求；所有发往模型供应商的流量都属于 pi 进程。

## 开发

```bash
npm install
npm run build          # 打包扩展 + Webview（含 mermaid bundle）
npm run watch          # 改动后自动重建
npm run verify         # 类型检查 + 单元/集成测试 + 生成代码一致性检查
npm run preview        # 构建后在普通浏览器里预览 Webview
npm run package        # 先 verify，再生产构建，最后 vsce package
```

目录结构：

```
src/        扩展宿主：视图 provider、RPC 客户端、pi 进程生命周期
webview/    侧边栏 UI（转写、输入框、会话、媒体）
shared/     两侧共用的协议类型与工具代码
scripts/    构建、预览、冒烟测试入口
test/       单元与集成测试（node:test）
```

提交与评审约定见 [CONTRIBUTING.md](https://github.com/dairycode/pi-agent-sidebar/blob/main/CONTRIBUTING.md)。

## 许可证

[MIT](https://github.com/dairycode/pi-agent-sidebar/blob/main/LICENSE)
