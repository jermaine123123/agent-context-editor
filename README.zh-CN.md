# Agent Context Editor

面向编码 Agent 的跨宿主上下文检查与视图状态管理项目。

English 首页：[README.md](README.md)

## 当前发布内容

- Pi 扩展 `pi-context-editor@0.3.0`：在 Pi TUI / Pi Desktop 中使用 `/ctx`，并保留原有 Tool Output 安全处理。
- DeepSeek Harness 适配器 `context-editor-deepseek-harness@0.1.1`：在同一 Session 的 Context Editor 视图中，reasoning 与 answer 可以独立搜索、选择、隐藏、恢复和持久化。
- Pi Context Desktop `0.1.4`：位于独立 fork [jermaine123123/pi-app](https://github.com/jermaine123123/pi-app) 的 Windows x64 社区构建。

DeepSeek 适配器把隐藏状态写入 `context_editor` sidecar，不改写原始 Harness
Session 日志和模型输入。当前隐藏只是视图操作，不会减少 Token 消耗。项目与
DeepSeek、Pi 官方及其维护团队没有隶属或赞助关系。

## 安装

从 [v0.1.0-alpha.1 Release](https://github.com/jermaine123123/agent-context-editor/releases/tag/v0.1.0-alpha.1)
下载两个 tarball：

```sh
pi install ./pi-context-editor-0.3.0.tgz
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

检查会运行 TypeScript、通用 Core、Pi 与 DeepSeek fixtures，重新生成 DeepSeek
Core/client，并确认 tarball 不含本地路径、模板或其他非发布文件。

## 限制与路线图

本 Alpha 版本不直接改写对话窗口、不从模型上下文排除消息、不压缩 Token、不在
Harness 中替换任意 Tool Output，也不增加更多宿主。后续方向包括正式的上下文排除
契约、更多宿主适配、签名桌面构建和更完整的跨宿主 fixtures。

## 许可证

MIT，见 [LICENSE](LICENSE)。
