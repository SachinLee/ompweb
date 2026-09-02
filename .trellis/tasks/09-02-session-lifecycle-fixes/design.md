# 会话生命周期修复技术设计

## 1. 设计边界与风险级别

本任务按 **critical profile** 执行：删除会话会永久移除 JSONL/artifacts，且修复跨越浏览器状态、Next.js API、RPC registry、Windows 子进程和磁盘缓存。设计只改变“临时会话失败恢复”和“会话删除幂等/反馈”边界，不改变 OMP RPC 协议、模型供应商或已有归档/分叉语义。

同一个 Trellis 任务保留两个垂直行为面，而不拆成子任务：恢复和删除都依赖同一套 `sessionId`、runtime registry 与 JSONL 权威关系；拆分会隐藏共享竞态。

## 2. 当前真实数据流

### 新会话

1. `AppShell` 通过 `newSessionCwd` 表示“尚未有会话文件的新聊天”。
2. `useAgentSession.ensureNewSession()` 调用 `/api/agent/new` 的 `ensure_session`。
3. `/api/agent/new` 用临时启动锁启动 `startRpcSession(tempKey, "", cwd, ...)`，OMP 返回真实 session ID；OMP 可能尚未写出 JSONL。
4. `promoteNewSession()` 调用 `onSessionCreated`；`AppShell` 把 `SessionInfo.path` 设为空字符串并清空 `newSessionCwd`，因此后续渲染走普通会话分支。
5. 如果首条 prompt 触发 Windows 10053 等连接错误，`RpcProcess` 退出，`AgentSessionWrapper.handleProcessExit()` 销毁 wrapper，但 `sessionIdRef` 和侧栏临时行仍可能保留。
6. 用户重试时当前客户端只 POST `/api/agent/{id}`；没有 live wrapper 且没有文件时，`resolveSessionPathOr404()` 返回 `session_not_found`。

### 删除

`app/api/sessions/[id]/route.ts` 当前先解析磁盘文件，再查 runtime。未落盘会话在查到 runtime 前就返回 404；已保存会话会扫描并重挂载 child，再确保 target `destroyAndWait()` 完成后删除文件，避免 OMP flush 重建文件。侧栏确认按钮已有 `setDeleting(true)` 和半透明行样式，但确认按钮没有 disabled/aria-busy/loading 标签。

## 3. 选定方案

### 3.1 临时会话 cwd 的权威来源

在 `lib/rpc-manager.ts` 增加 **仅内存、globalThis 承载** 的临时会话元数据表和短期 ID alias 表。临时表不能只记录 cwd，因为恢复出来的 OMP runtime 需要复用新会话启动时的工具/advisor 选择，并且旧 ID 的迟到请求必须能够被识别为同一个生命周期对象：
```text
sessionId -> {
  cwd,
  toolNames,
  advisor,
  requestedModel?,
  thinkingLevel?,
  runtimeId?,
  expiresAt,
}
```
`startRpcSession()` 在调用方传入空 `sessionFile` 且 wrapper 初始化后确认 `session.sessionFile === ""` 时登记真实 ID；如果初始化期间已经有真实文件，则直接走 saved 语义，不登记 temporary marker。使用 globalThis 与现有 registry 一致，兼容 Next.js 热重载；条目通过惰性 TTL 清理并设置最大条目数，默认沿用 idle runtime 的 10 分钟上限，避免首条失败会话永久泄漏。首次确认真实 JSONL 文件存在时删除 cwd/config marker，但可保留一个同 TTL 的 `oldId -> runtimeId` alias 供迟到请求完成 canonicalization；显式删除同时清理 marker、alias 和 path/list caches。

选择服务端表而不是只依赖浏览器 query：

- retry 不需把工作目录暴露在每次 POST URL 中；
- cwd 只来自 omp-web 自己创建的临时 wrapper，服务端能验证其目录存在；
- Next.js 重渲染、刷新和多个 Hook 调用不会丢失恢复所需元数据；
- 它是 transient runtime metadata，不改变 JSONL 格式，也不替代磁盘会话权威。
恢复生成新 OMP ID 时，必须原子地执行 `oldId -> runtimeId` 迁移：旧 ID 不再作为可 spawn 的独立 session key，`getRpcSession`/生命周期路由先解析 alias，再访问真实 wrapper。alias 只服务于短暂的迟到请求和删除，不改变磁盘 session identity；它有 TTL、有条目上限，并在删除完成后清除。恢复/删除共享一个按 canonical runtime ID（没有 alias 时按请求 ID）的 lifecycle lock，防止 recovery 在 DELETE 之后重新创建 wrapper，或两个 DELETE 并行 unlink 同一文件。

服务端重启后表会丢失；此时“无文件、无 runtime、无 transient metadata”按已删除/不存在处理，用户可以新建会话。这是内存状态的明确边界，不做伪持久化。

### 3.2 Agent command 恢复与真实 ID 传递

`app/api/agent/[id]/route.ts` POST 保持三段顺序：

1. **live fast path**：`getRpcSession(id)` 存活时直接发送，不做恢复 spawn。
2. **saved path**：文件存在时按现有 header/cwd 逻辑 resume，等待 wrapper ready 后发送。
3. **temporary recovery path**：第一次解析不到文件时查询 `getTemporarySession(id)`；有未过期记录时在 spawn 前再次解析 session path，若文件刚落盘则转回 saved path，否则以 marker 的 cwd/toolNames/advisor/config 调用 `startRpcSession(id, "", cwd, ...)`，恢复已确认的 model/thinking 配置后发送原命令；返回 `{ success: true, sessionId: realSessionId, recovered: true, data }`。
恢复 spawn 可能生成新 OMP ID（OMP 对无文件的新 runtime 自己生成），所以客户端不能假设旧 ID 永远不变。`lib/agent-client.ts` 为发送函数增加可选 `onSessionIdChange(previousId, nextId)` 回调，收到响应中的新 ID 时同步通知调用方；默认调用者无需处理 metadata，现有返回值仍是 `body.data`。
成功响应在三条路径都返回 `sessionId`，值为当前 wrapper 的真实 ID；失败响应保留现有稳定错误结构，不把 RPC/网络错误转换为 404。临时恢复只接受服务端表中的 cwd/config，目录再次检查为真实目录；不增加可由请求者任意指定 cwd 的 fallback。恢复 spawn 使用 marker 中的 `toolNames`/`advisor`，并在发送原命令前恢复已确认的 model/thinking 配置；如果配置恢复失败，返回实际错误并销毁该 replacement wrapper，不能留下第二个半活 runtime。
`useAgentSession.handleSend()` 在普通会话分支保存局部 `activeSessionId`：

- `session.path === ""` 且 `session.cwd` 可用时，把它标记为临时 retry；
- `get_state`、SSE、host tool 注册、subagent roster 和 prompt 都使用 `activeSessionId`；
- callback 收到新 ID 后必须迁移 `sessionIdRef`、advisor key/localStorage 和父级 temporary row，再让后续请求读取新 ID；
- 所有参与这次重试的 POST（至少 `get_state`、host-tool 注册、URI 注册和 prompt）都必须走同一个 ID-change 回调；旧 SSE/reconnect timer 必须带 generation fence，不能在迁移或删除后复活；
- 若 ID 在 prompt POST 与 SSE 建立之间变化，prompt 返回后重新连接新 ID 的 SSE 并触发一次状态 reconciliation，避免错过 terminal frame；
- 首次新会话仍复用现有 `ensureNewSession()` 和 promote 逻辑，只有 wrapper 已失效的 retry 走恢复分支。

`ChatWindow` 透传 `onSessionIdChanged`；`AppShell` 只在当前选中对象仍是临时行（`path === ""`）且 ID 匹配时更新 `selectedSession.id` 和 URL，不重置 Hook/消息状态。这样仍是同一用户可见会话，但服务器真实 runtime 绑定保持正确。

### 3.3 删除的三条路径

`DELETE /api/sessions/[id]` 先进入 lifecycle lock，再对 canonical ID 调用 `resolveSessionPath(id)`（不立即生成 404），最后分支。解析、destroy、re-resolve、删除和 cache invalidation 必须在同一把锁内完成：
1. **saved**：保持现有子会话重挂载、`destroyAndWait()`、`deleteSessionFileWithArtifacts()`、路径缓存和列表缓存失效顺序。
2. **temporary**：无文件但有临时元数据或 registry wrapper 时，先标记 deleting，再 `await rpc.destroyAndWait()`（即使 wrapper 已开始退出也 join 其 destroy promise），清除 transient metadata；随后再次 `resolveSessionPath(id)` 检查 child shutdown flush 是否已落盘。若出现文件，转入 saved 删除清理；仍无文件时失效列表缓存，返回 `{ ok: true, temporary: true }`。
3. **already deleted**：既无文件、无 wrapper、无 transient metadata/alias 时再次确认无路径、清除可能的 stale path cache，返回 `{ ok: true, alreadyDeleted: true }`。重复 DELETE 不再制造 404 噪声；由于服务端没有持久 tombstone，陌生 ID 也只能共享这个无副作用的幂等结果，不能把它误称为找到过的 session。

saved 路径不得提前返回 temporary；它仍必须执行现有 child re-parent/artifact 清理。temporary 路径没有文件扫描，不会把不存在的临时文件重新创建；如果 shutdown race 产生文件，则必须走同一 saved cleanup，而不是遗漏新文件。现有 child re-parent 扫描可以继续在 target destroy 前读取 sibling，但 target 的 `destroyAndWait()` 必须发生在最终 unlink 前；该顺序应作为单独测试不变量记录，不能笼统写成“整个 DELETE 从 destroy 开始”。

### 3.4 删除 UI 反馈

`SessionItem.handleDelete()` 保留现有单次请求逻辑，确认按钮增加 `disabled={deleting}`、`aria-busy` 和可见的 `deleting` 文案/状态；删除失败继续恢复按钮并 toast 实际失败。成功不恢复本行状态，因为父组件立即移除它。归档按钮也复用该 busy 锁，避免同一行并发操作。

`SessionSidebar.handleSessionDeleted()` 继续触发父级选中态/URL 清理和列表刷新；临时行不在 `allSessions` 时也必须走 `onSessionDeleted`，不能依赖已保存列表查找结果。
## 4. 公共接口、状态和不变量

### 接口变更

- `POST /api/agent/[id]` 的 live、saved、temporary 三条成功路径都返回 `sessionId`；temporary recovery 额外返回 `recovered: true`。旧客户端只读取 `data` 仍兼容。
- `lib/agent-client.sendAgentCommand()` 新增可选发送选项 `onSessionIdChange`；无选项时行为不变。
- `DELETE /api/sessions/[id]` 在无文件路径返回 200，并用 `temporary`/`alreadyDeleted` 区分结果；saved 成功响应保持现有 `skippedChildren`。
- `UseAgentSessionOptions`、`ChatWindow` props 新增 `onSessionIdChanged`，仅用于临时 runtime ID 迁移。
- `rpc-manager.ts` 增加 temporary marker/alias/lifecycle-lock 的最小导出测试 seam；不让 DELETE route 自己复制 registry 或锁逻辑。

### 状态不变量

1. 文件存在时，文件是 session identity/history 的权威来源；transient metadata 只能帮助无文件 runtime 恢复。
2. wrapper 存活时必须在 registry 中；wrapper 退出后不得出现在 running snapshot；temporary metadata 可在短 TTL 内保留以支持 retry。
3. 临时恢复成功返回新真实 ID 后，服务端 alias、客户端 `sessionIdRef`、后续 POST/SSE/URL 和父级 selected temporary row 必须指向同一个 canonical runtime；旧 alias 不得让 UI 永久停留在不可恢复状态。
4. saved DELETE 的最终顺序固定为 `destroyAndWait → re-resolve → delete file/artifacts → invalidate caches`；child re-parent 的 sibling 扫描若保留在 destroy 前，必须单独验证 target unlink 仍在 destroy 完成之后。不得让 live OMP flush 在删除后重建被删文件，也不得让 shutdown race 遗漏刚落盘的文件。
5. prompt 失败时 optimistic user bubble 回滚，但原文仍由 `insertIfEmpty` 放回输入框；running/streaming/reconcile timer 必须归零。
6. DELETE 对同一 ID 可重复调用而不产生副作用；首次清理和后续幂等响应都不能启动新 wrapper。
7. `POST /api/agent/new` 在 wrapper ready 后的 model/thinking 初始化失败必须销毁该 wrapper；只有 prompt 已经进入可人工重试阶段时才保留 temporary marker。
8. recovery/delete/late-request 使用同一 lifecycle lock 和 canonical ID；旧 alias 不能在 deleting/deleted 状态重新 spawn。

## 5. 错误与安全
- OMP 连接层错误（例如 stderr 中的 10053）继续通过 `handleProcessExit` notice 和 command error 展示；不伪装成 `session_not_found`。
- `session_not_found` 只用于 command 没有文件、没有 live wrapper、没有未过期临时 metadata/alias 的情况；真正陌生 ID 的 DELETE 可以返回无副作用的 `alreadyDeleted`，但 command 的 404 语义保留。
- 临时 cwd/config 只从 server-side transient table 读取，并在登记/恢复时要求 `statSync(cwd).isDirectory()`；不读取 POST body 中的任意 cwd，也不把路径拼接进 session 文件路径。
- 临时启动配置只从 server-side marker 读取；marker 中的 tool/model/advisor 字段按白名单保存，不能把整份请求 body 或 prompt 持久化到内存 metadata。
- session ID 仍由 OMP 生成；transient/alias 表只按完整 ID 查找，TTL 惰性清理并限制条目数，避免无界内存增长。
- 删除仍受现有 session ID/path 解析约束；不放宽 artifacts 目录边界，不改变子会话安全重挂载逻辑。

## 6. 兼容性、性能、可观测性

- 不修改 OMP RPC wire format、JSONL schema、模型配置或持久化文件。
- saved session resume、archive、fork 和非临时 command 的 response data 语义保持不变；新增字段可选。
- 仅临时 recovery command 允许 `sessionId` 发生迁移；普通 saved session 的 `sessionId` 必须稳定，避免 callback 把 fork/new-session 的业务返回误当成 runtime alias。
- 临时恢复最多增加一次与正常冷启动等价的 wrapper spawn；temporary DELETE 不扫描目录，saved DELETE 维持原扫描成本。
- 继续复用 `notifyRunningChange()`、`invalidateSessionListCache()` 和现有 SSE；不新增轮询器。
- 在恢复成功、临时删除和实际 ID 迁移处记录低敏 metadata（session ID、结果，不记录完整 prompt/cwd）；详细 OMP stderr 仍由现有 notice 受 8KB/500 字符边界限制。

## 7. 备选方案与拒绝原因

- **仅在前端永久携带 `?cwd=`**：会把本地路径放进每个请求 URL，且 Hook/刷新后容易丢失；不选。
- **让 OMP 复用旧 session ID**：无文件新 spawn 的 ID 由 OMP 生成，omp-web 无稳定 RPC 参数可强制指定；不假设不存在的能力。
- **为临时会话创建空 JSONL 占位文件**：会污染会话列表，并可能被 OMP flush 覆盖或误当成可 resume 历史；不选。
- **删除无文件会话继续返回 404**：正是用户当前“删除无反应”的根因；不选。
- **新增自动重试模型请求**：可能重复计费/重复执行用户 prompt，且超出本任务；不选。

## 8. Rollout、回滚与未决技术风险

- 变更仅涉及内存 transient metadata、可选 API 字段和 UI 状态，无数据迁移；可整体 revert 并重启 dev server。
- 回滚后已有 JSONL 不受影响；未落盘临时会话重新恢复旧的 404/删除 404 行为，不会损坏 saved sessions。
- 主要风险是 OMP 在 prompt ack 后立即退出并由新 wrapper 产生新 ID；实现以 response sessionId + SSE 重连 + state reconciliation 覆盖该窗口。
- Windows `taskkill /t` 仍由 `RpcProcess.dispose()` 负责；DELETE 必须等待 `destroyAndWait()`，并通过慢退出集成验证。
- 服务端重启会丢失 transient cwd/config、alias 和 lifecycle lock；重启后的旧无文件 ID 按临时会话已失效处理。UI 必须显示可重建/新建会话错误，不伪造持久恢复。

AC 覆盖：临时恢复和 ID 迁移覆盖 AC-001/AC-002；saved/temporary DELETE 覆盖 AC-003/AC-004；按钮 busy、父级选中态、URL、缓存和错误反馈覆盖 AC-005。