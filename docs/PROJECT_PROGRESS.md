# Agent Context Editor 项目进度

更新日期：2026-08-25
当前基线：Pi `0.84.2`、DeepSeek Harness rc.8；Pi TUI 与 DeepSeek Harness 的上下文排除均已完成并通过自动化和真实宿主验证

## 1. 项目目标

本项目的目标不是删除原始对话，而是在 Coding Agent 的长对话中提供一个可搜索、可筛选、可恢复的对话记录编辑器，帮助用户整理想保留的内容。

当前实现采用“共享 Core + 宿主适配器”结构：

```text
共享 Context Editor Core
├─ Pi TUI /ctx 适配器
├─ Pi Desktop/RPC 适配器
├─ DeepSeek Harness 适配器
└─ 独立的 Pi Context Desktop 社区构建
```

共享部分负责对话记录归一化后的 Record/Unit 投影、Stable ID、搜索、隐藏状态、恢复、撤销和 revision 校验；宿主适配器负责读取各自的 Session、保存状态以及提供对应的界面。

## 2. 当前版本和交付物

| 组件 | 当前版本/边界 | 当前状态 |
| --- | --- | --- |
| 共享 Core | 根目录 `packages/context-editor-core` | 已完成第一阶段，作为 Pi 与 DeepSeek 的行为基准 |
| Pi Extension | `pi-context-editor@0.4.0` | 已构建，支持 Pi TUI 与 Pi Desktop/RPC 的 `/ctx`；Pi TUI 支持模型上下文排除 |
| Pi TUI | Pi `0.84.2` | 全屏编辑器和上下文投影已实现，自动化测试与宿主回归通过 |
| Pi Desktop/RPC | Pi Desktop 原生对话框路径 | 可用，但仍是独立管理器，不改主聊天时间线 |
| DeepSeek Harness | `context-editor-deepseek-harness@0.2.0` | rc.8 原生上下文投影、独立 reasoning/answer、搜索筛选和真实 API smoke 已通过 |
| Pi Context Desktop | 独立 fork 的 Windows x64 `0.1.4` 社区构建 | 已发布边界记录，不属于本仓库的可复用适配器源码 |

Pi 和 DeepSeek 的发布包均为预构建 tarball；主项目本次发布为稳定版 `v0.2.0`，DeepSeek 宿主本身仍是 rc.8 Developer Preview。

## 3. 按最终功能表的完成度

以下功能表以“制定插件功能开发计划”最后讨论的合并结果为准。这里明确区分“独立 Context Editor 视图可用”和“直接作用于 Agent 主聊天窗口”。当前稳定版包含已验收的 Pi TUI 与 DeepSeek Harness 投影能力，主聊天时间线原位编辑仍不在范围内。

| 顺序 | 功能 | 当前完成度 | 目前实际行为 |
| --- | --- | --- | --- |
| 1 | 手动隐藏对话 | 部分完成 | Pi TUI、DeepSeek 和 Pi 原生管理器可以选择单元、连续单元或批量隐藏；reasoning 与 answer 可以独立处理。隐藏只作用于 Context Editor 视图，不隐藏 Pi 主聊天时间线。 |
| 1.1 | 隐藏全部对话 | 未开始 | 当前没有独立的“隐藏全部”入口；只能通过选择或筛选结果进行批量隐藏。后续应定义当前分支内全部可见 User、AI、Tool 单元的范围，并以一次可撤销的视觉状态变更提交，不修改 Session 或模型上下文。 |
| 1.2 | 恢复全部对话 | 已完成（视觉状态） | Pi TUI 使用大写 `R` 确认后恢复全部视觉隐藏单元；Pi Desktop/RPC 和 DeepSeek 也提供恢复全部入口。该操作只写入 `reset` 视觉事件，不删除原始记录，也不改变主聊天时间线或模型上下文。 |
| 2 | 从上下文中删除 | Pi TUI 与 DeepSeek Harness 已完成 | Pi TUI 使用 `x` 预览并确认 exclude/restore；投影事件写入独立 `<sessionFile>.context-editor.projection.json`，context hook 只改变 provider payload，不改 Session JSONL。DeepSeek rc.8 使用原生 `context/projection` 事件，只改变派生模型消息历史；两宿主的 Tool 配对、CAS、恢复和失败关闭均有测试。 |
| 3 | 保存当前对话修改 | 基础能力完成 | Pi TUI 的视觉状态仍写入 `<sessionFile>.context-editor.json`，模型投影写入独立 sidecar；两者均原子写入并按分支 anchor 读取。DeepSeek 使用 `context_editor` sidecar；Pi Desktop/RPC 保留旧 V1 CustomEntry 兼容路径。AI 摘要替换尚未实现。 |
| 4 | 按消息类型筛选 | 部分完成 | 独立编辑器支持 User、AI、Tool 筛选及组合筛选；筛选只改变编辑器列表，不改变主聊天时间线。 |
| 5 | 搜索对话记录 | 部分完成 | 默认只搜索 User 消息和 AI 最终回答；Pi TUI 按 `s`、DeepSeek 按搜索框按钮、Pi Desktop/RPC 按范围项临时切换全文（reasoning、Tool 名称/参数和输出）。支持 Unicode、逐次命中、命中次数和上一个/下一个结果；范围不写入 sidecar 或偏好。 |
| 6 | AI 精简整篇对话 | 未开始 | 尚未实现 AI 分析整篇对话并提出隐藏、删除或摘要建议的流程。 |
| 7 | AI 总结选中的一段对话 | 未开始 | 尚未实现选中片段提交给 AI 并生成摘要的流程。 |
| 7.1 | 在对话窗口中用摘要替换原内容 | 未开始 | 尚未实现“主窗口显示摘要、原文可展开恢复”的摘要卡片或替换状态。 |
| 7.2 | 在上下文中用摘要替换原内容 | 未开始 | 尚未实现只向模型发送摘要、同时保留原始记录的上下文投影。 |

### 当前阶段判断

视觉管理器、Pi TUI 和 DeepSeek Harness 上下文排除已具备可用基础：归一化、搜索、筛选、视觉隐藏、模型投影、恢复、批量操作、撤销和双 sidecar/原生 projection 持久化都已落地；“隐藏全部”仍列为后续功能。最终产品最关键的差距仍然是：

- 不能直接修改 Pi 或其他 Agent 的主聊天时间线显示；
- Pi Desktop/RPC 和其他 Agent 尚未接入模型上下文排除；
- 不能执行 AI 自动精简或选段摘要；
- 不能用摘要替换显示层或模型上下文中的原内容。

## 4. 已完成的实现

### 4.1 共享 Core

- Stable Atom、Record、Unit ID 已统一。
- 同一 AI Turn 的 reasoning 与回答归为一个 AI Record，并暴露为独立的 `#reasoning`、`#answer` Unit。
- Tool Call 与 Tool Output 按 `toolCallId` 配对。
- User、AI、Tool 三类 Record 支持统一搜索和筛选。
- 搜索结果包含 Record、Unit、Atom、字段、命中范围、摘要和 occurrence count。
- `ContextSearchScope` 统一提供 `dialogue`（默认）和 `all`；类型筛选仍作为上限，三宿主使用同一范围规则。
- V2 view events 支持 `hide`、`restore`、`reset`、连续 `undo`。
- 通过 `baseRevision`、source revision 和 fingerprint 处理并发修改与过期状态。
- V1 `context-editor-state` 只读取视觉状态；旧的 `contextState` 不再控制模型上下文。
- 宿主接口已改为支持宿主无关的 `appendViewEvent()`，同时保留旧适配器的兼容回退路径。
- Core 新增 `include/exclude` projection state、`ContextProjectionEventV1`、预览/提交纯函数和
  Tool Call/Result、签名 reasoning 工具链闭包；最终回答默认保持独立。
- 事件保存 transaction/base revision、Atom 源位置和 fingerprint；恢复只重放事件并重新读取原始 Atom，不保存摘要、digest、tombstone 或被排除原文。
- `ContextHostCapabilities.contextExclusion` 改为布尔能力；Pi 与 rc.8 DeepSeek Harness 均为 `true`，后者已通过真实 API smoke。

### 4.2 Pi TUI

- `/ctx` 使用 Pi TUI 全屏自定义界面，不修改 Pi 内置聊天渲染器。
- 支持导航、连续选择、批量选择、隐藏、恢复、恢复全部、撤销、筛选、搜索和命中导航；当前没有独立的隐藏全部快捷键或按钮。
- `Enter` 只临时展开/收起，`h` 持久隐藏，`r` 恢复隐藏；低频快捷键收进 `?` 帮助页。
- 搜索按每一次文字命中导航，确认后自动展开、定位、居中和高亮；支持同一回答内的 `n/N` 循环命中、Tool 名称命中和隐藏内容保护。
- `s` 在搜索输入状态下仍是普通查询字符；退出输入后才切换对话/全文范围。范围只保存在当前 `/ctx` 窗口，重开默认回到对话范围。
- reasoning 与回答可以分别展开、隐藏和恢复。
- 隐藏单元保留可恢复占位；关闭显示隐藏正文时，搜索可命中但界面不泄露隐藏正文。
- 长回答按终端宽度换行，不再限制为固定 8 行；展开内容支持 `PgUp/PgDn` 在单元内部滚动。
- 渲染使用视口窗口和正文缓存，避免每一帧重新生成整个长会话。
- `x` 先显示请求单元、自动扩展、最终影响范围和最近一轮警告，再确认 exclude/restore。
- 模型状态与 `h/r/R/u` 视觉状态分开显示；projection sidecar 不可用时禁用 `x`，仍可浏览和视觉操作。
- 终端宽度变化时会重新计算换行和滚动范围，并覆盖 CJK 宽字符测试场景。

### 4.3 Pi sidecar

- 固定路径为当前 Session 文件旁的 `<sessionFile>.context-editor.json`。
- 文件包含 `schemaVersion: 1`、`sessionId`、V2 view events、偏好和 revision 信息。
- 使用同目录临时文件、原子替换和写入锁。
- 写入前重新读取 Session 与 sidecar revision；发生竞争时拒绝旧写入并让界面刷新。
- 只应用当前分支祖先链上锚定的事件；后代分支继承，兄弟分支隔离。
- 损坏或属于其他 Session 的 sidecar 失败开放，不阻塞原始 Session。
- 独立的 `<sessionFile>.context-editor.projection.json` 保存 schema v1、Session ID、branch
  anchor 和追加式 projection events；原子临时文件、fsync、rename、lock 与 CAS 均已实现。
- `context` hook 在 provider 请求前按 Pi compaction-aware entries 对齐并投影；任何损坏、
  fingerprint/sourceRef 变化、消息歧义或 Tool 闭包不明都会 `ctx.abort()`，确保不发请求。
- `session_before_compact`/`session_before_tree` 在摘要覆盖排除项或完整性无法证明时取消摘要。

### 4.4 Pi Desktop/RPC 与 DeepSeek Harness

- Pi Desktop/RPC 路径提供原生选择、输入、确认和详情窗口；旧 V1 视觉 CustomEntry 仍可读取。
- DeepSeek Harness 适配器提供同一 Session 的 Context Editor 标签页。
- DeepSeek 中 reasoning 与 answer 可独立选择、隐藏、恢复和撤销；搜索默认对话范围，搜索框按钮可临时启用全文。
- Pi Desktop/RPC 在原生对话框增加搜索范围项，默认对话范围且不扩展 V1 `viewFilter` 持久化格式。
- DeepSeek Host 在 Session 运行期间保持可读；未稳定投影时拒绝写入，避免部分状态。
- 两个宿主都保留原始 Session 日志；视觉隐藏不会改变模型输入，只有明确确认的 context projection 才会改变后续派生消息历史。

### 4.5 语言、打包和安全边界

- `zh-*` 宿主使用中文界面，其他语言使用英文界面；原始对话内容不翻译。
- Pi 扩展、DeepSeek 包、Core vendoring、Bundle 和 tarball 校验命令已统一。
- Pi projection hook 不替换 Tool Output、不写入 canonical Session；损坏、CAS、fingerprint 或对齐失败时失败关闭。
- README、架构、安全和兼容性文档区分视觉隐藏、模型投影和 AI 摘要替换；本 MVP 不发送 digest/tombstone/摘要。

## 5. 自动化验证现状

截至 2026-08-25，以下核心验证命令已通过：

```text
npm run build:pi-core
npm run check
npm test
npm run scan:i18n
npm run build:pi
npm run build:deepseek
npm run build:client
npm run verify:pack
```

完整 `npm run verify` 已通过；本地 `deepseek-harness-latest` 仅作为未发布的 rc.8 验证夹具，已加入忽略规则，不进入 GitHub 仓库和发布 tarball。

验证结果：

- TypeScript 严格检查通过；
- 18 个测试文件通过；
- 84 个测试通过；
- 中英文 UI 字面量扫描通过；
- Pi vendored Core 和 Pi bundle 构建通过；
- DeepSeek Core/client 构建通过；
- Pi 与 DeepSeek tarball 内容校验通过。

重点覆盖的自动化场景包括：

- Stable ID、reasoning/answer 拆分、Tool 配对和跨宿主契约；
- 对话/全文搜索范围、类型筛选、逐次命中、命中次数和 Unicode 文本；
- 批量隐藏、恢复、连续撤销和 revision/CAS 冲突；
- Pi sidecar 原子写入、损坏文件失败开放、旧 V1 读取、分支继承与隔离；
- Pi TUI 键盘导航、连续选择、隐藏占位、搜索导航、长回答换行和分页滚动；
- Desktop/RPC 对话框流程、语言切换和详情预览；
- 视觉操作前后 Session JSONL 和模型消息投影保持一致；
- context projection 闭包、恢复原文、source fingerprint、sidecar CAS、分支 anchor、corrupt sidecar fail-closed、summary overlap cancellation 和 `x` 预览确认。

## 6. 真实宿主验证状态

### 已具备的验证基线

- Pi 适配器依赖和主要目标锁定在 `0.84.2`。
- Pi TUI 已完成本地 `/ctx` 基础冒烟，并已修复长回答展开不完整的问题。
- DeepSeek Harness 已按 Developer Preview commit `141eb6fef83422698aef7a981029e843e8161534` 和 CLI `@deepseek-ai/dsh@0.1.0-rc.8` 完成 Host/Browser/provider 验证及真实 API smoke。
- Pi Context Desktop `0.1.4` 已作为独立 Windows x64 社区构建记录。

### 尚未完全关闭的验收项

- Pi TUI 在 `80×24`、`120×40` 和动态 resize 下的完整人工回归尚未全部留档。
- Pi TUI 重启后 sidecar 偏好、长回答滚动、分支切换和冲突刷新需要按正式验收脚本再跑一遍。
- 需要在隔离的 `PI_CODING_AGENT_DIR`、`--session-dir` 中，用最终 tarball 重复核心流程。
- 需要记录安装、卸载和 Pi 配置无残留的最终结果。
- DeepSeek 适配器后续若跟随 Harness 新 commit，需要重新执行完整宿主验收；不能仅凭包安装成功判断兼容。

## 7. 下一阶段建议

### 阶段 A：维护 Pi TUI 与 DeepSeek 稳定版验收记录

先不增加新的 Agent 宿主，完成以下回归并形成验收记录：

1. 长文本、中文、reasoning、answer、Tool Call/Output 的展开和分页；
2. 隐藏、恢复、批量选择、Shift 连选、撤销和恢复全部；“隐藏全部”当前仍不纳入本阶段实现；
3. 关闭、重开、重启后的 sidecar 恢复；
4. 分支祖先继承与兄弟分支隔离；
5. Session/sidecar revision 冲突时拒绝旧写入并安全刷新；
6. 操作前后 Session JSONL SHA-256 完全一致；
7. 最终 tarball 的本地加载、安装、卸载和残留检查。

### 阶段 B：实现主聊天窗口适配

如果产品目标仍然是“直接在 Agent IDE 主聊天窗口精简对话”，应把这项单独作为宿主 UI 项目推进。共享 Core 可以复用，但 Pi TUI/ Pi Desktop/其他 Agent 的主时间线渲染器必须分别适配；当前独立 `/ctx` 编辑器不能自动获得这个能力。

### 阶段 C：扩大模型上下文控制宿主

Pi TUI 与 rc.8 DeepSeek Harness 的正式契约和安全门已经实现，并在真实 API smoke 后打开 `contextExclusion`。后续新宿主仍需各自完成同一验收流程。

### 阶段 D：实现摘要和 AI 精简

最后增加选段摘要、摘要显示替换、摘要上下文替换和 AI 全篇精简建议。AI 建议必须先展示、再由用户确认，并且每次变更可撤销；不要把摘要功能和当前视觉隐藏事件混为一类。

### 宿主选择原则

- Pi TUI：继续作为当前产品交互和真实终端行为的主要验证宿主。
- DeepSeek Harness：继续作为共享 Core、跨宿主记录结构和搜索结果的对照宿主。
- Pi Desktop 或第三个 Agent：作为后续主时间线适配验证，不承担 Core 规则的首次设计。

## 8. 当前结论

项目已经从“单宿主原型”进入“共享 Core + Pi TUI 与 DeepSeek Harness 上下文排除 + 独立管理视图”的稳定版阶段。两个宿主都能在不改写原始 Session 的前提下改变后续派生模型输入；主聊天时间线原位编辑、AI 精简和摘要替换仍未完成。

因此当前最准确的状态是：

> 当前状态：主项目 `v0.2.0` 稳定发布；Pi `0.84.2` 与 DeepSeek Harness rc.8 的上下文排除均已通过自动化验证和记录的宿主 smoke，摘要能力明确不包含在本版本。
