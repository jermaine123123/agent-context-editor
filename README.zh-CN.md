# Agent Context Editor

一个跨 Agent 的对话管理插件。对于已适配的宿主，它优先提供可预览、可确认、可恢复
的模型上下文排除：从后续模型输入中排除指定内容，同时完整保留原始 Session。除此
之外，它还提供可搜索、可筛选、可隐藏、可恢复的对话管理视图，支持按 User、AI、Tool
类型筛选，以及单条、连续范围和批量操作。

Agent 会话会积累用户指令、模型推理、旧回答和工具输出。Agent Context Editor 在原有
Session 之上建立独立的结构化管理视图，支持搜索整篇对话、定位结果、隐藏、恢复和撤销
视图修改。隐藏状态单独保存，原始 Session 不会被删除或改写。

项目的长期目标是在不同 Agent 宿主中提供一致的对话编辑方式：保持会话聚焦，重新打开
会话时快速找到用户选择保留的信息，控制哪些内容参与后续模型上下文，并让 AI 精简选中
的片段或整篇会话。

## 稳定版 v0.2.0 当前能力

稳定版 v0.2.0 已在 Pi TUI 和 DeepSeek Harness 上提供可用版本，包括：

- 默认只搜索用户消息和 AI 最终回答，也可临时切换到全文搜索；支持命中次数统计和上一个/下一个结果定位；
- User、AI、Tool 消息类型筛选及组合筛选；
- 单条、连续范围和批量选择；
- 可恢复的视觉隐藏、恢复全部、重置和撤销；
- 使用 sidecar 持久化隐藏状态，不删除或改写原始 Session；
- 通用 Core、Pi TUI 与 DeepSeek Harness 都把同一轮 AI 的思考和最终回答作为独立单元；
- Pi TUI 通过 `x` 排除或恢复模型上下文，先预览确认，并自动保持
  Tool Call/Result 配对和带签名 reasoning 链的协议闭包；
- 独立的 Pi 模型投影 sidecar 和失败关闭的 `context` hook；
  DeepSeek Harness 使用原生 `context/projection` 事件完成同一 Session 的上下文排除。

Pi TUI 中，`Enter` 只临时展开或收起当前单元，`h` 和 `r` 分别持久隐藏
与恢复。搜索会定位到第一个文字命中并自动居中、高亮，`n`/`N` 可逐个循环
命中；隐藏正文默认不会泄露，只有打开显示隐藏内容后才会显示。

当前视觉隐藏仍只改变独立 Context Editor 视图。上下文排除是独立的模型投影操作：
Pi TUI 和 DeepSeek Harness 只从后续 provider payload/派生消息历史中移除已确认内容，
不改写原始 Session 或 Surface 事件，也不会修改宿主主聊天时间线。恢复时重新从权威历史投影。
`x` 和 `R` 的确认会留在 Pi TUI 全屏编辑器内：按 `Enter`/`y` 确认，按 `Esc`/`n` 取消。

Pi TUI 按 `s` 在“对话范围/全文范围”之间切换；`1/2/3` 控制用户、AI、工具，`4/5` 分别控制 AI 思考和回答，AI 总筛选会联动两个子项。DeepSeek Harness 在搜索框旁提供同样的范围切换。搜索范围只在当前编辑窗口生效，不写入 sidecar；Pi Desktop 交互保持不变。

English 首页：[README.md](README.md)

## 当前发布内容

- Pi 扩展 `pi-context-editor@0.4.0`：在 Pi TUI / Pi Desktop 中使用 `/ctx`；Pi TUI 通过 `x` 排除/恢复模型上下文，Desktop/RPC 仍只管理视觉状态。
- DeepSeek Harness 适配器 `context-editor-deepseek-harness@0.2.0`：在同一 Session 的 Context Editor 视图中，支持独立 reasoning/answer 单元、搜索筛选和原生上下文排除。
- Pi Context Desktop `0.1.4`：位于独立 fork [jermaine123123/pi-app](https://github.com/jermaine123123/pi-app) 的 Windows x64 社区构建。

DeepSeek 适配器把视觉隐藏状态写入 `context_editor` sidecar，不改写原始 Harness
Session 日志和 Surface 事件；上下文排除只改变派生模型消息历史，不会把被排除原文写入
Session，也不会减少视觉隐藏本身的 Token 消耗。项目与
DeepSeek、Pi 官方及其维护团队没有隶属或赞助关系。

## 产品路线图

后续能力与当前已经可用的视觉管理器分阶段开发：

1. 适配 Agent 主聊天时间线，并在宿主扩展接口允许的情况下接入更多 Agent 宿主。
2. 实现 AI 辅助精简：分析整篇对话，提出保留或排除建议，并为选中片段或整篇会话
   生成摘要。
3. 经用户确认后，用摘要替换对话窗口中的原内容、模型上下文中的原内容，或同时替换
   两者；原文保持可恢复，所有修改均可撤销。

AI 精简和摘要替换仍属于后续计划；稳定版已包含 Pi TUI 和 DeepSeek Harness 的上下文排除能力。

## 界面语言

Context Editor 会自动跟随宿主语言：`zh-*` 中文环境使用中文界面，其他
系统或浏览器语言使用英文。Pi Context Desktop 如果已有应用语言设置会
跟随该设置，否则使用系统语言。Pi TUI、Pi 原生 `/ctx` 对话框和 DeepSeek
Harness 视图会在打开时识别语言。只翻译编辑器控件和状态提示，不会翻译
Session 中的原始内容。

Pi TUI 把 V2 视觉事件写入 `<sessionFile>.context-editor.json`，模型投影事件写入独立的
`<sessionFile>.context-editor.projection.json`；Pi Desktop/RPC 仅保留旧的 V1 视觉 CustomEntry
兼容路径。Pi 的 projection hook 只删除已确认且结构闭包安全的目标，Tool Output
不会被替换，主聊天时间线也不支持原位隐藏。

## 安装

从 [Release assets](https://github.com/jermaine123123/agent-context-editor/releases)
下载两个 tarball。Pi `0.84.2` 的本地 `pi install` 接受包目录，不直接解包
`.tgz` 文件；请先解压 Pi 包，使 `package.json` 位于目录根部，再运行：

```sh
pi install ./pi-context-editor-0.4.0
dsh plugin --profile <profile> add ./context-editor-deepseek-harness-0.2.0.tgz
```

如果直接使用本仓库，可以安装包目录：

```sh
pi install ./adapters/pi-extension
```

Pi Desktop 还需要运行 `adapters/pi-extension/scripts/install-desktop.ps1`，脚本支持
`-PiPath` 和 `-DesktopExePath` 参数；安装后完全退出并重新打开 Pi Desktop。

DeepSeek 适配器的验收宿主为 Harness Developer Preview commit
`141eb6fef83422698aef7a981029e843e8161534`、CLI `@deepseek-ai/dsh@0.1.0-rc.8`。

## 目录结构

```text
agent-context-editor/
├─ adapters/pi-extension/      Pi /ctx 适配器
├─ adapters/deepseek-harness/  DeepSeek 适配器与发布构建
├─ packages/context-editor-core/通用 TypeScript Core 与测试
├─ docs/                       架构、兼容性和安全说明
├─ assets/                     脱敏演示帧与社交预览图
├─ scripts/                    构建、打包和发布检查
└─ test/                       宿主适配器回归测试
```

`pi-app/` 不放入主仓库，它保留完整上游历史并作为独立 GitHub fork 发布。

## 开发检查

```sh
npm ci
npm run verify
```

检查会运行 TypeScript、通用 Core、Pi 与 DeepSeek fixtures，重新生成 Pi vendored
Core 和 bundle、重新生成 DeepSeek Core/client，并确认 tarball 不含本地路径、模板或其他非发布文件。

## 当前限制

稳定版不直接改写对话窗口或主聊天时间线，不生成 AI 摘要、不用摘要替换原内容、不在
Harness 中替换任意 Tool Output，也还没有适配更多 Agent 宿主。Pi Desktop/RPC 仍只管理
视觉状态；Pi TUI 和 DeepSeek Harness 的模型上下文排除依赖各自的投影路径，遇到 sidecar
损坏、revision 冲突、source fingerprint 变化或消息对齐含糊时会失败关闭，
不会发送 digest、tombstone 或摘要占位符。

## 许可证

MIT，见 [LICENSE](LICENSE)。
