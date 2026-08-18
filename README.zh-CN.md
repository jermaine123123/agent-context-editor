# Agent Context Editor

给 Coding Agent 长对话增加一个可搜索、可隐藏、可恢复的管理视图，同时保留原始
Session。

和 Coding Agent 协作久了，一段会话里会积累大量推理、旧回答和工具输出。Agent
Context Editor 提供一个独立的管理视图，支持搜索、类型筛选、批量选择、隐藏、恢复
和撤销。隐藏状态单独保存，原始 Session 不会被删除或改写。

当前项目已经完成 Pi Desktop 和 DeepSeek Harness 适配。DeepSeek Harness 版本还能
分别处理同一轮 AI 的 reasoning 与最终回答。

项目仍处于 Developer Preview，Pi TUI 还会继续验证，后续会尝试接入更多 Agent 宿主。

English 首页：[README.md](README.md)

## 当前发布内容

- Pi 扩展 `pi-context-editor@0.4.0-alpha.1`：在 Pi TUI / Pi Desktop 中使用 `/ctx`，共享 Record/Unit Core，并把隐藏限定为视觉状态。
- DeepSeek Harness 适配器 `context-editor-deepseek-harness@0.1.1`：在同一 Session 的 Context Editor 视图中，reasoning 与 answer 可以独立搜索、选择、隐藏、恢复和持久化。
- Pi Context Desktop `0.1.4`：位于独立 fork [jermaine123123/pi-app](https://github.com/jermaine123123/pi-app) 的 Windows x64 社区构建。

DeepSeek 适配器把隐藏状态写入 `context_editor` sidecar，不改写原始 Harness
Session 日志和模型输入。当前隐藏只是视图操作，不会减少 Token 消耗。项目与
DeepSeek、Pi 官方及其维护团队没有隶属或赞助关系。

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

## 限制与路线图

本 Alpha 版本不直接改写对话窗口、不从模型上下文排除消息、不压缩 Token、不在
Harness 中替换任意 Tool Output，也不增加更多宿主。后续方向包括正式的上下文排除
契约、更多宿主适配、签名桌面构建和更完整的跨宿主 fixtures。

## 许可证

MIT，见 [LICENSE](LICENSE)。
