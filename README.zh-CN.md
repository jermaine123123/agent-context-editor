# Agent Context Editor

Agent Context Editor 是一个可以手动排除和编辑 AI 对话上下文的跨 Agent 插件，同时支持搜索、筛选、选择、隐藏、恢复和撤销对话内容，并保留原始 Session。

## 当前功能

- 手动排除选中的上下文，并随时恢复
- 手动编辑 User 消息和 AI Answer，支持恢复原文与撤销
- 搜索对话并在多个结果之间跳转
- 按 User、AI、Reasoning、Answer 和 Tool 类型筛选
- 支持单条、连续范围和批量选择
- 隐藏、恢复、重置和撤销视觉修改
- 分别管理 AI Reasoning 和最终 Answer
- 自动保存修改状态，不覆盖原始 Session
- 自动适配中文和英文界面

## 支持的宿主

| 功能 | Pi TUI | Pi Desktop/RPC | DeepSeek Harness |
| --- | ---: | ---: | ---: |
| 搜索与筛选 | 支持 | 支持 | 支持 |
| 单条、连续范围和批量选择 | 支持 | 支持 | 支持 |
| 独立管理 Reasoning 和 Answer | 支持 | 支持 | 支持 |
| 视觉隐藏、恢复、重置和撤销 | 支持 | 支持 | 支持 |
| 手动排除模型上下文 | 支持 | 不支持 | 支持 |
| 手动编辑 User/Answer | 支持 | 不支持 | 支持 |
| 保留原始 Session | 支持 | 支持 | 支持 |
| 中文和英文界面 | 支持 | 支持 | 支持 |

手动排除上下文和文字编辑目前支持 Pi TUI 与 DeepSeek Harness。可编辑内容仅限纯文本 User 消息和完整、无签名的 Answer。

独立的 [Pi Context Desktop](https://github.com/jermaine123123/pi-app) 社区构建为 Windows x64 提供视觉对话管理功能。

## 安装

### Pi 扩展

从 [Release assets](https://github.com/jermaine123123/agent-context-editor/releases) 下载 `pi-context-editor-0.5.0.tgz`。Pi `0.84.2` 安装本地包目录，不直接安装 `.tgz` 文件。请先解压，使 `package.json` 位于目录根部，然后运行：

```sh
pi install ./pi-context-editor-0.5.0
```

直接使用本仓库时，可以安装适配器目录：

```sh
pi install ./adapters/pi-extension
```

注册 Pi Desktop 时，请使用 PowerShell 运行 `adapters/pi-extension/scripts/install-desktop.ps1`。Pi 安装在非标准位置时，可以传入 `-PiPath` 和 `-DesktopExePath`。安装完成后需要完全退出并重新启动 Pi Desktop。

### DeepSeek Harness

从 Release assets 下载 `context-editor-deepseek-harness-0.3.0.tgz`，然后使用 Harness 官方 CLI 安装：

```sh
dsh plugin --profile <profile> add ./context-editor-deepseek-harness-0.3.0.tgz
```

当前适配器面向 DeepSeek Harness Developer Preview commit `141eb6fef83422698aef7a981029e843e8161534` 和 `@deepseek-ai/dsh@0.1.0-rc.8`。经过测试的宿主边界见[兼容性文档](adapters/deepseek-harness/COMPATIBILITY.md)。

## 使用方法

### Pi TUI

输入 `/ctx` 打开全屏 Context Editor。主要操作包括使用 `x` 排除或恢复上下文、`e` 编辑文字、`E` 恢复原文、`h` 和 `r` 进行视觉隐藏与恢复，以及使用 `s` 切换搜索范围。按 `?` 可以查看完整快捷键说明。

### Pi Desktop/RPC

输入 `/ctx` 打开原生 Context Editor 对话框。该路径支持搜索、筛选、选择和视觉隐藏与恢复，暂不支持模型上下文排除和 User/Answer 编辑。

### DeepSeek Harness

打开普通 Chat 视图旁边的 `Context Editor` 标签页。该标签页管理同一个 Session，支持上下文排除、User/Answer 编辑、搜索、筛选、选择、视觉隐藏、恢复和撤销。

## 工作方式

Agent Context Editor 读取现有 Session，并在独立管理视图中显示 User、AI、Reasoning、Answer 和 Tool 内容。同一轮 AI 的 Reasoning 与最终 Answer 可以分别管理，相关的 Tool Call 与 Tool Result 会保持配对。

视觉修改和模型上下文修改分别保存。视觉隐藏只改变 Context Editor。经过确认的上下文排除和受支持的文字编辑只改变后续发送给模型的派生输入，不覆盖原始 Session，也不修改宿主的主聊天时间线。

## 当前限制

- 不能直接编辑或隐藏宿主主聊天时间线中的内容。
- Pi Desktop/RPC 不支持模型上下文排除和文字编辑。
- Reasoning、Tool、System、附件、结构化 User 和带签名的 Answer 不能编辑。
- 不支持批量替换文字。
- 视觉隐藏不会改变模型输入或减少 Token 使用。
- 暂无单独的“隐藏全部”操作，但支持恢复全部。
- 暂不支持 AI 自动精简、选段摘要和摘要替换。
- DeepSeek Harness 兼容范围限于已经测试的 rc.8 宿主边界。

## 当前版本

当前稳定版为 `v0.3.0`：

- Pi 扩展：`pi-context-editor@0.5.0`
- DeepSeek Harness 适配器：`context-editor-deepseek-harness@0.3.0`
- Pi Context Desktop 社区构建：`context-editor-v0.1.4`

详细更新和验证结果见 [v0.3.0 发布说明](docs/release-notes-v0.3.0.md)。

## 路线图

- 支持更多 Agent 宿主和主聊天界面
- 增加 AI 辅助 Session 精简和上下文整理建议
- 增加可恢复的摘要生成与替换

### 后续探索方向

- 探索面向单次请求的 Conversation Context Router：在每次发送 Prompt 前，判断当前任务与历史对话的关联，组合尽可能精简且依赖完整的临时上下文。路由结果只影响本次派生模型输入，不改写原始 Session，并支持预览、解释、人工覆盖和完整上下文回退。

## 开发

需要 Node.js 22.19 或更高版本。本地验收记录使用 Node 24。

```sh
npm ci
npm run verify
```

`npm run verify` 会构建两个适配器，执行 TypeScript 检查和自动化测试，扫描发布内容并校验发布包。

## 目录结构

```text
agent-context-editor/
|-- adapters/
|   |-- pi-extension/          Pi /ctx 适配器
|   `-- deepseek-harness/      DeepSeek Harness 适配器
|-- packages/context-editor-core/
|-- docs/
|-- assets/
|-- scripts/
`-- test/
```

`pi-app/` 保持为独立 Git 仓库，不包含在本仓库中。

## 项目声明

Agent Context Editor 是独立的社区项目，与 Pi、DeepSeek 及其维护团队不存在隶属、认可或赞助关系。

English documentation: [README.md](README.md)

## 许可证

MIT，见 [LICENSE](LICENSE)。
