# Context Editor 0.6.0：官方 Desktop / Harness rc.2 验收

日期：2026-10-01（北京时间）。最终插件包：`release/context-editor-deepseek-harness-0.6.0.tgz`。

SHA-256：`bc79c4c26c4811983eef13785427e74820ec86b95671b88c82af1c330a2d14c0`。

## 发行包与隔离环境

官方 [Windows 更新源](https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml)锁定 `0.2.0-rc.2`；发布于北京时间 2026-09-29 18:35:27。验收使用从 [官方地址](https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.0-rc.2-win-x64.exe)下载、校验并解包的发行包，未使用 GitHub 源码替代运行时。

- 安装包长度：289313640 字节。
- 更新源 SHA-512：`raIlxMQd9ESXgktmViW7QwVLcjBR5JIsrNOu+SpelY8kskdSr2H51/f+ey1EqFI/eIIrKQCuRANMeb5SptRZcg==`，实际计算一致。
- Desktop / Harness 均为 `0.2.0-rc.2`。实际构建提交：`04f392c9ddd144fa426da2045178797da6db6c11`，dirty=false；内置 Node `24.18.1`。
- Session、Persistence、JSONL Persistence、v3→v4 Codec、Agent Loop、DeepSeek Adapter、Conversation UI 均为 rc.2。发行包没有旧名 `dsh-client-runtime` 的独立清单，发行包身份记录将该项标为 unavailable。正常插件安装为这个兼容 peer 解析了 `0.1.0-rc.8`，实际兼容报告明确记录此值，没有把它标为 rc.2；界面注入与加载单独通过实际窗口验证。
- GitHub 标签提交 `639ed015397290b3745d163aafe02ffee4aa3f84` 仅用于接口分析，不能替代上述构建身份。
- 隔离目录：`.compat-desktop-026`；桌面界面配置位于 `home-ui`，Host/云端配置位于 `home`。日常安装未升级，官方宿主、事件目录和校验器未修改。

插件通过官方 `runCli` 管理 Desktop profile 的正常插件安装流程安装，未使用版本豁免。插件管理器提示部分可选/历史 peer 不齐；安装成功，实际面板和 RPC 成功加载。安装脚本用 SHA-256 命名 tarball URI，避免包管理器缓存同名旧包。每次验收先将安装目录的全部 24 个打包文件与最终 tarball 逐字节比较。

## 实现

1. `host-api` / `host-compat` 集中解析宿主格式、可选公开接口和版本身份。仅 v4 且必要写入接口完整时启用现代写入路径；未知格式或缺少校验器关闭对应功能并给出原因。
2. v4 用 `model/selection` 持久化下一次请求选择，正常 Agent 生成 `request/header`。操作读回同时识别选择事件和后续请求头，保留维护锁、操作 ID 和不可变配置。未发送下一条请求也能保存、重启、恢复选择。
3. 自产消息使用 `context-editor` 生产者来源。检查点候选在脱离实时日志的副本上通过官方 v4 格式/关系校验后，再追加、flush、持久化读回。独立 `tool` 角色保留 call ID、错误标志和关联，图片与已知签名思考受保护。
4. 旧 profile 1/2/3 保持可读。结构转换或分支引用迁移先证明原始消息身份/指纹、生成新的配置和引用，再核实持久化选择；原 profile 不原地改写。不能证明的引用拒绝迁移。
5. 布局和操作 RPC 保持原有设计。诊断新增格式、实际构建及分层证据；内存自检不会自行标记持久化、实际请求、界面或云端通过。peer 只明确加入 `0.2.0-rc.2`。

## 逐项结果

所有下列最终验收记录均绑定上述 SHA-256。正常请求测试使用发行包的实际 Agent 和官方 Provider Adapter；除单独标明的云端冒烟外，服务端为合成本地 HTTP/SSE。

| 项目 | 结果与证据边界 |
| --- | --- |
| 正常安装、启动、RPC、版本身份 | 通过；`installation.json`、`v4-contract-evidence.json`、桌面快照及面板证据。没有版本豁免。 |
| 新版 Harness 集成矩阵 | 27 组全部通过，详见 `candidate-acceptance.json`；包含普通文本、标题、并发、10 万事件、精简、原生压缩、工具/图片/签名、恢复及中断。 |
| 编辑、排除、撤销、恢复、保存后重启 | 通过实际 Agent 请求验证；原始事件指纹保持，恢复前不意外重新引入排除内容。 |
| 模型及思考强度切换 | 通过 Agent 和官方 Desktop `session/selectModel`；保存后重启，请求使用 `deepseek-v4-pro`、thinking=enabled、effort=low，同时保留编辑。桌面窗口中的选择调用为官方 RPC，没有把它描述为下拉菜单点击验收。 |
| A/B 精简、后续聊天、只恢复 A | 通过；B 摘要、A 的现有编辑及后续 C 保持，恢复后再次编辑/精简、恢复 B、再次重启均检查实际请求。 |
| 原生压缩覆盖、恢复分支及继续聊天 | 通过；已覆盖检查点拒绝原地恢复，不追加日志；分支继承准确前缀并可继续聊天、再次精简和重启。 |
| 正常与失败工具链 | 通过；闭合工具组排除/恢复，失败结果保留 is_error，恢复后的请求只有一个对应结果。 |
| 宿主补齐失败结果 | 通过；使用官方 `buildForkSeed` 生成未开始工具调用的修复，验证 `TOOL_NOT_STARTED`、v4 日志、错误标志、排除/恢复后唯一调用/结果。 |
| 图片、签名思考 | 合成本地请求通过；图片附件不丢失，已知签名不改变，完整工具关系保持。图片参与精简明确拒绝。此项没有真实云端签名/图片认证。 |
| 四个提交阶段中断、重复提交、过期 revision | 通过；pending/appended/flushed/result 各自独立进程，读回、恢复、重试检查；重复操作不重复追加，旧 revision 冲突。 |
| 恢复响应丢失 | 最终包在官方 Host 的浏览器面板通过：服务端先完成恢复，拦截丢弃响应，客户端读回核实并清除等待状态，B 和后续消息保留。此拦截证据不冒充原生窗口协议测试。 |
| 缺失配置、缺少 v4 校验器、未来格式 | 通过；实际删除合成 profile 后正常请求拒绝且零 Provider HTTP；可选接口缺失/format=5 不阻止模块加载，但关闭写入。 |
| 旧配置 1/2/3 升级 | 通过真实 v4 校验器与官方 JSONL Persistence；生成新配置、previous 引用、读回验证，旧行不变。 |
| 旧 v3 合成会话跨版本恢复 | 通过独立升级分支；编辑、工具排除、重启、恢复、再次重启均检查请求，原日志 SHA-256 不变。 |
| 官方 Desktop 窗口 | 通过实际可见 Electron 窗口：面板编辑/排除/恢复、键盘提交、诊断折叠、窄窗口、精简、分支导航和继续精简、A/B 单项恢复。窗口关闭重启后的编辑和模型请求另有记录。英文视图在同一官方 Host 的浏览器客户端测试。 |
| 云端冒烟 | 通过 User 编辑→保存→重启→正常请求。任务累计 7 次真实请求；前 4 次旧尝试未作为功能通过证据，最终包 3 次 HTTP 200 完整结束（包括辅助标题请求）。无额外真实调用用于故障、图片、工具或精简矩阵。 |
| 旧官方 npm `0.1.5-rc.1` | 最终包 25 组全部通过，独立使用该安装的实际依赖；旧宿主测试采用它支持的 Chat Completions，不承诺 Messages 签名。 |
| 项目检查与打包 | 类型检查通过；47 个测试文件中 46 通过、1 跳过，266 项通过、3 跳过；Core/Client 构建、i18n 扫描、包结构检查及最终包敏感信息扫描通过。 |

全仓库通用敏感信息扫描仍会命中既有 OpenCode 文档/测试路径和解包的第三方运行时；不将此项标为全仓库通过。最终插件包单独扫描通过，报告不保存模型密钥。原有 17 项针对测试作为改动前基线，最终使用上述更完整的项目检查。

## 跨版本恢复的限制

旧插件历史记录中的回合外 `request/header` 会被官方 v3→v4 导入拒绝，不能直接宣称全部旧会话可无缝升级。本次提供的离线恢复助手只接受独立、未压缩的 v3 JSONL 根会话：它证明旧头部除了 provider/model/effort 配置外没有其他变化，转换为选择事件，调用官方迁移接口，在**新会话 ID** 下经 v4 校验及持久化读回；不修改原文件。

助手不接受继承种子、子代理、catalog/delivery 标记或非配置头部变更。使用前停止隔离 profile，备份日志及插件两个存储域。对应合成日志从旧版实际生成，而非手工拼一个仅能通过校验的事件序列。升级后的原始日志来源指纹保留；不把迁移后结构变化误报成原事件字节不变。

单项恢复只适用于仍活跃的确切检查点。被覆盖时使用分支恢复。新版 Surface 中的选择不能跨越未选择的 System 快照；应选连续完整回合或重新生成范围。直接编辑签名思考、图片精简、未知 replay 和自定义原生压缩 Provider 仍不支持。

## 复现

在本仓库根目录运行，需 Node 24、Windows tar、7-Zip；窗口测试另需已安装的 Playwright 和 Edge。正常安装需要网络访问。准备脚本检查官方 feed 版本和 SHA-512；官方 feed 已更新时，使用保留的匹配 feed/安装包和 `-OfflinePrepare`，不会悄悄换成新版本。

```powershell
powershell -File scripts/verify-deepseek-060.ps1 `
  -Root .compat-desktop-026 -Version 0.2.0-rc.2 `
  -Archive release/context-editor-deepseek-harness-0.6.0.tgz `
  -OfflinePrepare -LegacyHarness D:/deepseek-harness/0.1.5-rc.1 `
  -DesktopWindow `
  -Playwright D:/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs
```

全套入口串行运行 Host 与 Desktop，避免相同默认端口的并发冲突。`-CloudSmoke` 单独选择、累计账本限制 8 次；现有本次账本已用 7 次，不足以再跑一个两次请求的完整新会话冒烟。已保留的云端证据可运行 `node scripts/verify-deepseek-cloud-capture.mjs .compat-desktop-026 <archive>` 离线复查，**不再次请求模型**。

旧 v3 会话恢复示例（在备份且停止的隔离目录中）：

```powershell
$env:CE_SESSION_ROOT = '<isolated-session-storage-root>'
node scripts/upgrade-deepseek-legacy-session.mjs .compat-desktop-026 '<session.v3.jsonl>' '<new-session-id>'
```

助手不会复制整个存储域；新会话须在保存原插件存储的同一隔离 profile 中使用。完整旧版→新版合成复测步骤见交付的 `REPRODUCE.md`。

## 证据说明

详细 JSON、原始合成事件/指纹、请求、截图和脚本保存在 `release/deepseek-0.6.0-rc2-validation/`。`ACCEPTANCE.json` 汇总最终包身份、各组结果和证据文件清单，原始失败尝试保留在工作目录，不覆盖成“从未失败”。

云端最后一轮原断言错误地在全部消息中禁止原 User 标记；真实模型在不应修改的 Assistant 回答中引用了它。修正为只检查 User 角色后，离线重新审查保留的真实请求证据通过。`cloud-original-assertion-evidence.json` 与 `cloud-reviewed-evidence.json` 同时保留，可核查修正原因。未消耗第 8 次调用，也不声称云端覆盖整个本地矩阵。

上述结论仅覆盖这份最终 tarball、锁定的发行包和列出的场景。后续版本应再次执行同一验收流程。
