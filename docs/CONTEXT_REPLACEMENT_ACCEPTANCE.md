# Pi TUI 与 DeepSeek Harness 手动上下文编辑验收记录

日期：2026-08-26  
范围：共享 Core、Pi TUI 0.84.2、DeepSeek Harness `@deepseek-ai/dsh@0.1.0-rc.8`（commit `141eb6fef83422698aef7a981029e843e8161534`）。两个宿主均对符合条件的 User/Answer 单元开启 `contextReplacement`。

本记录覆盖本次稳定包的手动上下文编辑路径；结构化、签名、reasoning、Tool、System、
附件和批量替换保持禁用。

## 已验证行为
- 两个宿主都支持纯文本 User 和完整、无签名 Answer 的替换、恢复、单元 LIFO 撤销和原文对照；排除优先于替换，列表、搜索和 Provider composer 使用 `effectiveText`。
- Pi TUI 使用原生多行编辑器；DeepSeek Host/Core 本地合成确认替换文本进入派生 payload，原始替换文本和排除内容不进入。

- User/Answer replacement event 使用 schema v1 sidecar，支持 replace、restore、按当前单元 LIFO undo。
- 事件按 atom 顺序、sourceRef 和 fingerprint 校验；错误 undo、过期 revision、重复/多解消息对齐均失败关闭。
- 生效文本用于列表和搜索；排除优先于替换，视觉隐藏保持独立。
- Answer 跨 assistant entry 时只在最后一个 Answer text atom 注入新文本，reasoning、tool call、tool result 顺序保持不变。
- /ctx 的 e/E/z/o 与原有 h/x/r/R/u 共存；编辑通过 Pi 原生多行 editor，取消或 CAS 冲突会刷新并保留筛选、搜索和焦点。
- Host 回归验证 sidecar 写入前后 canonical Session JSONL 的 SHA256 不变，并覆盖分支锚点继承/兄弟隔离。

## 自动化命令

| 命令 | 结果 |
| --- | --- |
| npm run build:pi-core | 通过 |
| npm run check | 通过 |
| npm test | 通过：20 个测试文件，89 个测试 |
| npm run scan | 通过 |
| npm run scan:i18n | 通过 |
| npm run build:pi | 通过 |
| npm run build:deepseek | 通过 |
| npm run build:client | 通过 |
| npm run verify:pack | 通过 |
| 临时 PI_CODING_AGENT_DIR 安装 Pi tarball、执行 pi list，并用本地 faux provider 捕获实际 payload | 通过，payload 含 EDITED_USER，未修改用户配置 |

关键新增测试：

- test/replacement.test.ts
- test/pi-replacement.test.ts
- 既有 projection hook、sidecar、UI、Host、跨宿主和 DeepSeek 回归测试全部通过。

## 本地产物

- `release/v0.3.0/pi-context-editor-0.5.0.tgz`
- `release/v0.3.0/context-editor-deepseek-harness-0.3.0.tgz`
- 两个 tarball 的 SHA-256 以 `release/v0.3.0/SHA256SUMS.txt` 为准。

## 边界

本记录覆盖自动化 hook/provider payload 投影、Pi 0.84.2 临时包加载、本地 faux provider payload 捕获、DeepSeek rc.8 profile 安装和 Web 启动（HTTP 200）。未使用真实外部模型 API，也未重复执行浏览器人工编辑和重启回归；DeepSeek 宿主仍属于 Developer Preview，后续 Harness commit 需要重新验收。
