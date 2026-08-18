# Agent Context Editor

一个面向 Coding Agent 长对话、以跨宿主为目标的会话内容编辑器。

项目希望在 Codex、Pi、OpenCode 等 Agent IDE、桌面应用或 TUI 宿主中提供一致的
对话管理方式：让用户决定长对话中哪些内容继续显示或参与后续模型上下文，重新打开
会话时能快速找到过去的结论，并最终可以让 AI 精简选中的片段或整篇会话。Codex 和
OpenCode 目前只是计划适配的目标宿主，并不是已经完成的集成。

和 Agent 长期协作后，一篇会话会积累大量用户指令、模型推理、旧回答和工具输出。
Agent Context Editor 在原有 Session 之上建立一个结构化管理视图，支持搜索整篇对话、
按 User、AI、Tool 类型筛选消息、选择单条或多条记录，以及隐藏、恢复和撤销视图修改。

## Developer Preview 当前能力

第一阶段已经在 Pi 和 DeepSeek Harness 上提供可用版本，包括：

- 全篇会话文本搜索、命中次数统计和上一个/下一个结果定位；
- User、AI、Tool 消息类型筛选及组合筛选；
- 单条、连续范围和批量选择；
- 可恢复的视觉隐藏、恢复全部、重置和撤销；
- 使用 sidecar 持久化隐藏状态，不删除或改写原始 Session；
- 在 DeepSeek Harness 中分别处理同一轮 AI 的 reasoning 和最终回答。

当前隐藏只改变独立 Context Editor 视图，不会修改宿主的主聊天时间线，不会从后续
模型输入中删除消息，也不会减少 Token。Pi TUI 的完整真实宿主验收仍在继续。

English 首页：[README.md](README.md)

## 当前发布内容

- Pi 扩展 `pi-context-editor@0.4.0-alpha.1`：在 Pi TUI / Pi Desktop 中使用 `/ctx`，共享 Record/Unit Core，并把隐藏限定为视觉状态。
- DeepSeek Harness 适配器 `context-editor-deepseek-harness@0.1.1`：在同一 Session 的 Context Editor 视图中，reasoning 与 answer 可以独立搜索、选择、隐藏、恢复和持久化。
- Pi Context Desktop `0.1.4`：位于独立 fork [jermaine123123/pi-app](https://github.com/jermaine123123/pi-app) 的 Windows x64 社区构建。

DeepSeek 适配器把隐藏状态写入 `context_editor` sidecar，不改写原始 Harness
Session 日志和模型输入。当前隐藏只是视图操作，不会减少 Token 消耗。项目与
DeepSeek、Pi 官方及其维护团队没有隶属或赞助关系。

## 产品路线图

后续能力与当前已经可用的视觉管理器分阶段开发：

1. 适配 Agent 主聊天时间线，并在宿主扩展接口允许的情况下接入 Codex、OpenCode
   等更多应用。
2. 实现可恢复的上下文排除：由用户手动把选中消息从后续模型输入中移除，但不销毁
   已保存的原始 Session。
3. 实现 AI 辅助精简：分析整篇对话，提出保留或排除建议，并为选中片段或整篇会话
   生成摘要。
4. 经用户确认后，用摘要替换对话窗口中的原内容、模型上下文中的原内容，或同时替换
   两者；原文保持可恢复，所有修改均可撤销。

上下文删除、AI 精简和摘要替换目前都属于后续计划，尚未包含在当前发布版中。

## 界面语言

Context Editor 会自动跟随宿主语言：`zh-*` 中文环境使用中文界面，其他
系统或浏览器语言使用英文。Pi Context Desktop 如果已有应用语言设置会
跟随该设置，否则使用系统语言。Pi TUI、Pi 原生 `/ctx` 对话框和 DeepSeek
Harness 视图会在打开时识别语言。只翻译编辑器控件和状态提示，不会翻译
Session 中的原始内容。

Pi TUI 把 V2 视觉事件写入 Session 旁的 sidecar；Pi Desktop/RPC 仅保留旧的
V1 视觉 CustomEntry 兼容路径。Pi 不注册上下文替换 hook，Tool Output 不会被
替换，主聊天时间线也不支持原位隐藏。

## 安装

从 [Release assets](https://github.com/jermaine123123/agent-context-editor/releases)
下载两个 tarball：

```sh
pi install ./pi-context-editor-0.4.0-alpha.1.tgz
dsh plugin --profile <profile> add ./context-editor-deepseek-harness-0.1.1.tgz
```

Pi Desktop 还需要运行 `adapters/pi-extension/scripts/install-desktop.ps1`，脚本支持
`-PiPath` 和 `-DesktopExePath` 参数；安装后完全退出并重新打开 Pi Desktop。

DeepSeek 适配器的验收宿主为 Harness Developer Preview commit
`47f943859bef60e4160492346772ded9b24f765a0`、CLI `@deepseek-ai/dsh@0.1.0-rc.6`。

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

本 Alpha 版本不直接改写对话窗口、不从模型上下文排除消息、不压缩 Token、不生成
AI 摘要、不用摘要替换原内容、不在 Harness 中替换任意 Tool Output，也还没有适配
Codex 和 OpenCode。视觉隐藏不等于模型上下文控制。

## 许可证

MIT，见 [LICENSE](LICENSE)。
