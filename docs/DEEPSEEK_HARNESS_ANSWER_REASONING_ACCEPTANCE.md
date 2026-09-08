# DeepSeek Harness 0.3.1 Answer/Reasoning 联动验收记录

日期：2026-09-09

## 环境与候选包

- Harness 目录：`D:\pi context editor\deepseek-harness-latest`
- Profile：`.user-data\profiles\web`
- Harness：rc.8，commit `141eb6fef83422698aef7a981029e843e8161534`
- 适配器：`context-editor-deepseek-harness@0.3.1`
- 候选包：`release/v0.3.1/context-editor-deepseek-harness-0.3.1.tgz`
- 实际安装源：`D:\context-editor-deepseek-harness-0.3.1-final.tgz`（同一 SHA-256，用于规避 pnpm 同路径缓存）
- SHA-256：`0F60613F03BE3F1F316281D07E4046B9D116CBBA63F77C291BC1455E224AF822`（`release/v0.3.1/SHA256SUMS.txt`）
- 安装前备份：`.user-data\profiles\web\context-editor-backup-before-0.3.1-20260909-013042`

## 已完成的本地验证

1. `test/projection.test.ts`、`test/replacement.test.ts`、`test/deepseek-harness-core.test.ts`、`test/deepseek-harness-package.test.ts` 定向套件：23 tests passed。
2. `npm run check`、`npm run scan`、`npm run scan:i18n` 通过。
3. `npm run build:deepseek`、`npm run build:pi-core`、`npm run build:client`、`npm run build:pi` 通过；生成文件由脚本重建。
4. DeepSeek 官方 CLI 已把 0.3.1 安装到目标 web profile；profile manifest、lockfile 和已安装 package 均为 0.3.1。
5. 目标 Harness 以 `DSH_HOME=...\.user-data pnpm dsh web --port 3080 --no-open` 启动，服务输出 `http://127.0.0.1:3080`。安装包 Host fixture 读取正常，Answer snapshot 暴露 `effectiveText`、`replacementSupported` 和 `associatedReasoningUnitIds`；同一 in-process rc.8 Session 的一次 commit/undo 验证了单个 operationId、Reasoning 排除、`session.deriveMessages()` Payload 和 Surface/原始事件不变。
6. 直接向实际 `/api/contextEditor/getSnapshot` 发送 rc.8 Typert `args.request` 请求时，服务返回结构化的 `session not found`（HTTP 200），没有再出现 `Failed to fetch`；这只验证路由/协议挂载，不替代真实 Session UI 验收。CUA 浏览器自动化两次因本机 Windows sandbox `helper_unknown_error: setup refresh had errors` 退出，因此没有把静态首页 200 记作浏览器功能通过。

## 代码级联动覆盖

- 同一 `turnId` 的 Reasoning/Answer 关联，跨多个 assistant 根事件。
- 默认勾选、取消勾选、预先排除、仅排除变化、签名思考到工具链的确认范围。
- 一个 `operationId` 的 sidecar + 原生 projection、CAS/运行中拒绝、幂等重试、未匹配预写失败关闭。
- 连续编辑整体 LIFO 撤销；后续独立排除/恢复不被整体撤销覆盖。
- 原始 Surface 与历史消息逐条不改，只追加合法 `context/projection`。

## 尚待用户侧完成

- 在目标 web profile 中打开真实 Session，手工检查编辑弹窗、默认联动、影响范围确认、保存、恢复原文、整体撤销和重启恢复。
- 用本地假 Provider 通过宿主实际请求链路确认勾选时 Payload 不含本轮 Reasoning，取消勾选时不新增排除；当前已完成 in-process `session.deriveMessages()` Payload 检查，Provider 端到端捕获仍待用户侧执行，本仓库不记录 Prompt。
- 使用真实 DeepSeek 凭据发送一次请求并确认协议链路。凭据、Cookie、Prompt 和响应正文不得写入日志或验收材料。

因此，0.3.1 已满足本次 GitHub 发布门槛；自动化与隔离安装已通过，浏览器人工和真实 API 两项仍作为已知验证边界明确披露。