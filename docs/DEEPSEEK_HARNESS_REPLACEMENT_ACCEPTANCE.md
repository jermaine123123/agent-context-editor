# DeepSeek Harness 手动上下文编辑迁移验收记录

日期：2026-08-26  
稳定包：`context-editor-deepseek-harness@0.3.0`  
目标宿主：`@deepseek-ai/dsh@0.1.0-rc.8`，Developer Preview commit `141eb6fef83422698aef7a981029e843e8161534`  
当前能力：`contextExclusion: true`，`contextReplacement: true`（适用于已测试的 rc.8 宿主边界）

## 已完成范围

- 纯文本 User 和完整、无签名 Answer 支持 replacement event v1。
- replacement 先写入 `context_editor.replacementEvents`，再追加同 `operationId/eventId` 的原生 `context/projection`。
- 原始 Surface 节点、历史消息和主聊天时间线不改写；读取时只接受能匹配原生投影事件的 replacement 记录。
- 合成顺序为“原文 → 替换 → 排除”，因此排除优先；搜索、预览和 Provider composer 使用 `effectiveText`。
- 支持恢复原文、当前单元 LIFO 撤销、原文对照、CAS 冲突和同 operationId 幂等重试。
- reasoning、tool、结构化 User、签名/ replay 绑定 Answer、附件和批量替换保持不可编辑。

## 自动化验证

| 项目 | 结果 |
| --- | --- |
| `npm run verify` | 通过 |
| 测试 | 20 个测试文件，89 个测试通过 |
| TypeScript、敏感信息、i18n 扫描 | 通过 |
| Pi Core / Pi bundle 构建 | 通过 |
| DeepSeek Core / Client 构建 | 通过 |
| `npm run verify:pack` | 通过；Pi 与 DeepSeek 包内容校验通过 |
| DeepSeek Host/Core 本地合成冒烟 | 通过；覆盖 User/Answer effectiveText、排除后编辑、恢复排除、幂等重试和 assistant source 清理 |
| 隔离 npm profile 安装 0.3.0 tarball | 通过；manifest 版本正确，包含 20 个包文件 |
| 目标 rc.8 web profile 安装与启动冒烟 | 通过；`.user-data\profiles\web` 已加载 0.3.0，--dump-config 包含 context-editor，HTTP 200 |

## 本地产物

- 文件：`release/v0.3.0/context-editor-deepseek-harness-0.3.0.tgz`
- 稳定版发布目录和大小校验：`release/v0.3.0/SHA256SUMS.txt`
- 发布资产由 GitHub Release `v0.3.0` 提供；本轮不发布 npm。

## Provider 与真实宿主状态

本地 fake Provider 合成已确认：编辑后的文本会进入派生请求，原始被替换文本和被排除内容不会进入该请求；原始 Surface/历史事件仍逐条保留。该验证没有记录任何密钥。

已将 0.3.0 安装到用户指定的 rc.8 Harness：`D:\pi context editor\deepseek-harness-latest\.user-data\profiles\web`，并通过 profile 配置合成检查；同时保留了安装前 profile 配置备份。已启动 Web UI 冒烟实例（`http://127.0.0.1:3080`，HTTP 200，不打开浏览器、不发起模型请求）。本轮不重复浏览器人工编辑和重启回归；当前环境没有可用的 DeepSeek 真实 API 凭据，因此未执行外部 API smoke。DeepSeek 宿主仍属于 Developer Preview，后续 Harness commit 需要重新验收。

## 已知边界

- 本轮未执行真实 DeepSeek API 请求，也不保存任何密钥；稳定包兼容范围锁定在已测试的 rc.8 宿主边界。
- 本轮不重复浏览器人工编辑和重启回归；后续 Harness commit 或宿主升级需要重新执行对应验收。
- 当前未实现主聊天时间线原位编辑、Tool/结构化/签名内容替换、AI 精简和摘要替换。
