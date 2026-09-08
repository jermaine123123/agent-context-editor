# Pi TUI Answer 联动排除 Reasoning 验收记录

日期：2026-09-09
范围：共享 Core、Pi Extension、Pi TUI 0.84.2；DeepSeek Harness 仅作为既有跨宿主回归基线。

## 本轮交付

- /ctx 选中单个 Answer 后按 e，先进入 Pi 原生多行编辑器，再进入联动影响确认页；不会嵌套两个 ui.custom。
- 有同一 turnId 的 Reasoning 时，确认页默认勾选“同时从模型上下文排除本轮思考”；Space 切换，Enter 保存，e 返回草稿，Esc 取消整次编辑。
- Core 统一计算跨 assistant entry 的关联 Reasoning、签名 Reasoning 的 Tool Call/Result 闭包和 confirmedUnitIds；TUI 不自行推断关联范围。
- Answer 替换与新增排除写入同一 replacement 事件、同一 projection sidecar 原子事务，共用 revision/CAS。
- z 撤销当前 Answer 最近一笔 replacement/restore 事务，并只恢复该事务新增且仍归其所有的 Reasoning/Tool 排除；提前排除、后续独立排除和 E 恢复 Answer 原文均保持独立。
- context hook 接受混合事件序列；从已投影输入撤销时可恢复 Reasoning、Tool Call、Tool Result，Answer 仍只在最后一个文本位置出现一次。
- sidecar 对 linkedExclusion 的 operationId、unitId、atom 引用、fingerprint、sourceRef、重复 atom 和坏事件失败关闭；旧排除-only 文件仍可读。
- 新增确认页中英文提示；空白文本、无变化、冲突和不可确认范围均不写入事件，并刷新视图。

## 自动化验证

| 命令 | 结果 |
| --- | --- |
| npm test | 通过：20 个测试文件，94 个测试 |
| npm run check | 通过 |
| npm run scan | 通过 |
| npm run scan:i18n | 通过 |
| npm run build:pi-core | 通过 |
| npm run build:pi | 通过 |
| npm run pack:pi | 通过 |
| npm run verify:pack | 通过 |
| Pi 定向联动/投影/UI/sidecar 测试 | 通过：6 个文件，27 个测试（包含在全量结果中） |

覆盖：Answer 编辑并勾选/取消勾选联动 Reasoning；跨 assistant entry 的 reasoning、签名 Tool Call/Result 闭包；提前已排除内容不被整体撤销恢复；连续编辑、restore、LIFO undo、E 不取消 Reasoning 排除；canonical 与已投影输入的恢复；revision 冲突、坏 linked 字段、旧 sidecar、确认页返回修改/取消/no-op；原始 Session JSONL SHA256 在编辑、恢复、撤销和排除操作前后保持不变。

## Pi 0.84.2 隔离加载

- 版本：Pi 0.84.2。
- 本地候选 tarball 解包到一次性临时 npm 目录后，dist/index.js 导入通过。
- 使用隔离 PI_CODING_AGENT_DIR 和 --no-extensions --extension <dist/index.js> 启动 Pi，扩展入口加载通过；未出现扩展加载错误。
- Pi 0.84.2 的 pi install <file>.tgz 会把 tarball 注册为本地“扩展文件”，随后 loader 提示未知 .tgz 扩展名；这是该版本包管理器对本地 tarball 的限制。本轮用解包后的 --extension 路径完成宿主加载检查，没有修改用户全局配置。
- 本环境没有可用的本地 provider 捕获器；CLI smoke 在 Pi 启动后进入默认 Google provider 并被环境权限拒绝（403），未将该外部请求结果作为功能门禁。Provider payload 的联动投影由本地 projection-hook/Pi Host faux-provider 测试覆盖。

## 本地产物

- 发布包：`release/v0.3.1/pi-context-editor-0.5.1.tgz`
- SHA256：见同目录 `SHA256SUMS.txt`


## 未纳入本轮

- 直接编辑 Reasoning；Pi Desktop/RPC 联动确认页；DeepSeek Harness UI 重做；真实外部模型 API 请求；长时间人工 TUI 记录（中文多行、resize、重启）仍需在有可控交互终端时补录。
