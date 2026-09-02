# 修复会话删除与启动后终止

## Goal

让新建会话在首次模型/RPC 请求失败后仍能被可靠重试或清理，让已保存会话可以从侧栏删除并立即从界面消失；同时保留足够明确的错误信息，区分网络连接中断、运行时进程退出和会话文件不存在。

## Current behavior and problem

- 点击工作区的“新建会话”只设置前端状态；首次发送时 `hooks/useAgentSession.ts:1153-1197` 调用 `/api/agent/new` 的 `ensure_session`，服务端在 `app/api/agent/new/route.ts:55-75` 启动 RPC 进程并返回真实 ID，但此时 OMP 可能尚未写出 JSONL 会话文件。
- 首次消息发送前，`hooks/useAgentSession.ts:2368-2407` 会先连接 SSE，再发送 prompt；失败时只回滚乐观消息和运行状态，未形成可继续操作的持久会话状态。
- `lib/rpc-manager.ts:335-348` 在子进程异常退出时销毁 wrapper；若会话尚未落盘，后续 `app/api/sessions/[id]/route.ts:280-282` 和 `lib/api-utils.ts:8-13` 按磁盘解析会返回 `session_not_found`。
- 实测 OMP 18.0.11 在当前模型请求中出现 Windows `os error 10053`（连接被本机/代理/上游中断）；随后新会话接口仍能返回 200，但 `/api/sessions/{id}` 返回 404，而 `/api/agent/{id}` 可能短暂返回运行时状态。
- 删除 UI 在 `components/SessionSidebar.tsx:2847-2858` 已发送 `DELETE /api/sessions/{id}`；已保存会话删除实测返回 200。临时未落盘会话删除只能得到 404；删除过程中界面只有透明度变化，反馈不明确。
- 删除 API 在 `app/api/sessions/[id]/route.ts:308-395` 会扫描同目录会话、等待 live child 退出后再删文件；应避免 live child 继续写回已删除文件，并保持缓存失效。

## In scope

- 修复新会话从 `ensure_session`、首条 prompt、SSE 连接到失败恢复的生命周期一致性。
- 处理 OMP 子进程因网络/模型连接错误退出时的会话状态、错误提示、重试和清理路径。
- 修复已保存会话和尚未落盘但仍由 omp-web 管理的会话的删除行为。
- 保持会话文件、运行时注册表、侧栏列表、当前选中会话和 URL 状态同步。
- 为可复现的生命周期边界补充针对真实调用链的回归验证，并验证 Windows 进程退出路径不再产生悬挂/复活会话。

## Out of scope

- 不在本任务内修复 `estfaery.com`、代理软件、Clash、VPN、防火墙或上游模型服务本身。
- 不更换模型供应商、网络协议或 OMP RPC 协议。
- 不改变会话归档、分叉、工作区管理和消息内容格式的产品语义，除非为保证删除/恢复一致性必须调整其调用边界。

## Actors and affected systems

- 用户：点击新建、发送首条消息、重试失败消息、删除会话。
- 浏览器：`AppShell`、`SessionSidebar`、`ChatWindow`、`useAgentSession` 的乐观状态、SSE 和 URL 同步。
- Next.js API：`/api/agent/new`、`/api/agent/[id]`、`/api/agent/[id]/events`、`/api/sessions/[id]`。
- OMP runtime：`RpcProcess`、`AgentSessionWrapper`、会话 JSONL 文件和 Windows 子进程树。

## Assumptions and constraints

- 会话浏览以磁盘 JSONL 为权威；运行时注册表只在子进程存活期间有效，不能永久替代会话文件。
- 新会话的 JSONL 可能在启动成功、首条 prompt 被接受或首个 assistant 事件之后才出现；实现不得用一个尚未落盘的 ID 假装文件已存在。
- 网络错误应被作为可理解的启动/发送失败展示；不能吞掉错误，也不能把所有失败错误地转换为“会话不存在”。
- 必须遵守现有 Node/Next 运行时约束、Windows `taskkill /t` 清理策略、缓存失效机制和现有 i18n/Toast 模式。
- 启动请求在 runtime 已创建但模型/思考级别初始化失败时，不得遗留一个浏览器无法引用的匿名 live wrapper；已经进入 prompt 执行阶段的失败仍须保留可人工重试的临时恢复记录。
- 恢复与删除是同一个 session identity 上的互斥生命周期操作；迟到的旧 ID 请求不得在删除后重新 spawn wrapper，也不得绕过 ID 迁移继续写入旧状态。

## Acceptance criteria

### AC-001: 首条消息成功后会话可继续使用

- Scenario: 用户从工作区新建会话并发送首条文本消息。
- Action: OMP 接受 prompt 并产生会话文件或等价的可恢复状态。
- Expected: 当前会话获得真实 ID，侧栏、URL、聊天内容和后续发送使用同一个会话；不出现 `session_not_found`。
- Must not: 在会话文件尚未准备好时让普通会话加载流程覆盖新会话状态。
- Verification method: 新会话端到端 smoke test，覆盖 `ensure_session`、首条 prompt、状态读取和第二条 prompt。

### AC-002: 首条消息网络/RPC 失败可重试

- Scenario: 新会话首次 prompt 触发 OMP 子进程退出或连接层错误（包括 Windows 10053）。
- Action: 用户查看错误并再次发送同一消息或新消息。
- Expected: UI 显示具体可理解的失败原因，输入内容不丢失；若运行时仍可恢复则复用/恢复同一会话，否则建立新的可用运行时，不把失败状态误报成已保存会话不存在。若失败发生在 `ensure_session` 的模型/思考级别初始化阶段，服务端清理已创建的 wrapper；若失败发生在 prompt 已提交之后，服务端保留短期恢复元数据供用户再次发送。
- Must not: 失败后留下永久运行中的假会话、悬挂 spinner 或静默丢失草稿。
- Verification method: 注入 RPC 子进程退出/命令失败的确定性测试，加浏览器 smoke test 验证重试。

### AC-003: 已保存会话删除立即生效

- Scenario: 用户删除一个已保存且可能有 live wrapper 的会话。
- Action: 在侧栏确认删除。
- Expected: 服务端先安全停止 live child，再删除会话文件及其 sibling artifacts；响应成功后该会话从侧栏消失、当前 URL 清空或切换到新会话态，后续读取返回 `session_not_found`。
- Must not: 子进程退出 flush 后重新创建被删除文件，或缓存继续展示旧会话。
- Verification method: API/文件系统回归测试和实际 UI 删除 smoke test。

### AC-004: 临时会话删除可清理

- Scenario: 用户删除尚未写出 JSONL、但仍由 omp-web 管理的临时会话。
- Action: 在侧栏确认删除。
- Expected: 删除操作清理运行时并从 UI 移除；若无可删除文件，接口仍返回明确的幂等成功或专门的临时会话结果，而不是无反馈的 404。与恢复、另一个 DELETE 或迟到请求并发时，生命周期锁保证最终只留下“已删除”状态，不启动替代 wrapper。
- Verification method: 运行时 registry + API 单元/集成测试，覆盖“无文件但 wrapper 存活”和“wrapper 已退出”两种边界。

### AC-005: 删除过程有明确反馈并保持状态一致

- Scenario: 删除操作因停止进程、文件扫描或 Windows 清理而需要等待。
- Action: 用户确认删除后等待响应。
- Expected: 删除按钮进入可识别的 loading/disabled 状态，失败时显示实际错误；成功后侧栏、选中态、URL、未读标记和会话缓存同步更新。
- Must not: 重复发送删除请求或因慢响应让用户误以为点击无效。
- Verification method: 浏览器交互 smoke test，配合慢退出测试替身验证按钮状态和请求次数。

## Key decisions

- 首条消息失败后保留当前临时会话和输入内容，允许用户重试。
- 若原 wrapper 仍存活，下一次发送优先复用同一个 wrapper；若 wrapper 已退出，则由服务端为该临时会话重新建立可用 runtime，前端继续保留同一会话视图并更新运行时绑定。
- 删除临时会话必须同时清理运行时 registry；无 JSONL 文件时按幂等成功处理，不把“尚未落盘”误报为普通会话不存在。

## Open or blocking decisions

- 无。技术实现必须遵守上述失败恢复策略；上游网络/代理/模型服务修复明确不在本任务范围内。
