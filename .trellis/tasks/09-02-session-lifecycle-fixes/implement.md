# 会话生命周期修复执行计划

## 执行规则

- 质量配置：**critical**。涉及持久化会话删除、运行时生命周期和 Windows 子进程树。
- 先 RED 后 GREEN；每个 slice 只触及其声明的边界，不运行 formatter，不在实现中途运行全量测试。
- 不使用新依赖，不创建空 JSONL 占位文件，不自动重发用户 prompt。
- `npm run dev` 运行期间禁止 `next build`；最终 build 若仓库门禁要求，先停止开发服务器，再在干净进程中单独执行。

## Slice 1：AC-001/AC-002 —— 临时会话元数据与服务端恢复

- **Behavior**：首条 prompt 失败且 JSONL 未落盘后，服务端仍能凭 transient marker 为同一临时会话重新 spawn wrapper 并发送下一条命令；无 transient metadata 的陌生 ID 仍返回 `session_not_found`。`ensure_session` 后的 model/thinking 初始化失败必须销毁已创建 wrapper。
- **Code boundary**：
  - `lib/rpc-manager.ts`：globalThis transient marker、短期 alias、TTL/条目上限、canonical ID 解析和 lifecycle lock；`startRpcSession()` 在无文件 runtime 就绪后登记。
  - `app/api/agent/new/route.ts`：登记有限的启动配置；model/thinking 初始化失败时 destroy + 清理，prompt 已进入人工重试阶段时保留 marker。
  - `app/api/agent/[id]/route.ts`：live → saved → temporary recovery 分支；恢复配置后返回真实 `sessionId` 与可选 `recovered`。
  - `lib/rpc-manager.test.mjs`、`lib/api-contract.test.mjs`：可测试的 marker/alias/lock 与路由契约。
- **Test seam**：从 `rpc-manager.ts` 导出的 transient/canonical/lifecycle-lock 函数；路由行为至少通过可执行 helper/route 测试验证，source contract 只补充分支防回归，不作为并发安全的唯一证据。
- **RED**：
  1. 在 `lib/rpc-manager.test.mjs` 增加 remember/get/migrate/clear temporary marker、alias canonicalization、过期和条目上限测试，先确认断言失败。
  2. 增加并发 lifecycle-lock 测试：recovery 与 DELETE、两个 DELETE 同时开始时只允许一个终态清理，DELETE 完成后不得再调用 `startRpcSession`。
  3. 在 `lib/api-contract.test.mjs` 增加 route 必须读取 marker/config、调用 `startRpcSession(id, "", cwd, toolNames, ...)`、返回 `sessionId`/`recovered`，且不从任意 body cwd spawn 的断言。
  4. 增加 `app/api/agent/new` 的失败清理契约，证明 model/thinking 初始化失败会调用 `destroyAndWait`，而 prompt 阶段失败不被误处理成匿名 orphan。
- **Implementation**：
  1. 增加 bounded globalThis marker/alias/lifecycle-lock 状态，并提供 `rememberTemporarySession`、`getTemporarySession`、`migrateTemporarySessionId`、`resolveCanonicalSessionId`、`clearTemporarySession` 和 `withSessionLifecycleLock` 等最小 seam。marker 只在 `sessionFile === ""` 且就绪 state 仍无 session file 时登记。
  2. 在 marker 中保存经白名单过滤的 cwd、toolNames、advisor、requestedModel/thinking 配置；第一次确认真实文件存在时停止 recovery marker，但保留短期 alias，删除时统一清理。
  3. 在 `app/api/agent/new` 中区分 startup configuration 与 prompt 阶段：start/ready 或 model/thinking 设置失败时 `destroyAndWait` 并清理；prompt 已发送后的 RPC/网络失败不自动重发，保留 marker 供用户重试。cwd 必须用 `statSync(...).isDirectory()` 验证。
  4. 在 agent command route 中保留 live fast path 与 saved resume 行为；解析不到文件时在 lifecycle lock 内查询 canonical temporary marker，重新检查文件和目录，使用保存的 spawn 配置启动无文件 wrapper，恢复配置后发送原命令，成功返回当前真实 `sessionId`。失败保留 command/RPC 原错误，不降级为 404；replacement 配置失败必须 destroy。
  5. live、saved、temporary 三条成功路径统一返回真实 `sessionId`；非临时路径的返回只增加 envelope 字段，不改变 `data`。
- **GREEN**：
  - `node --experimental-strip-types --test lib/rpc-manager.test.mjs lib/api-contract.test.mjs`
- **Validation**：
  - 重复执行临时 metadata 测试，确认跨测试清理；检查 route 仍通过既有 malformed-command、advisor、request-size 合约。
- **Dependencies**：无。
- **Rollback**：回退 `rpc-manager.ts` transient 表和 agent route 分支；saved session resume 不受影响，临时失败恢复回到旧 404。

## Slice 2：AC-001/AC-002 —— 前端传播真实 runtime ID

- **Behavior**：服务端临时恢复生成新 OMP ID 时，下一次 SSE、prompt、URL 和当前选中会话使用新 ID；首条失败消息仍回到输入框，成功 prompt 不重复发送。
- **Code boundary**：
  - `lib/agent-client.ts`：可选发送选项 `onSessionIdChange`，读取 response envelope 的 `sessionId`，仍返回 `data`。
  - `hooks/useAgentSession.ts`：临时行识别（`session.path === ""`）、局部 `activeSessionId`、retry 的 callback、恢复后的 SSE/reconcile。
  - `components/ChatWindow.tsx`：透传 `onSessionIdChanged`。
  - `components/AppShell.tsx`：仅更新仍匹配的临时 `selectedSession` ID 和 URL，不 remount/清空消息。
  - `lib/agent-client.test.mjs`、必要的 `lib/api-contract.test.mjs` 合约断言。
- **Test seam**：`sendAgentCommand()` 的 HTTP response envelope；既有 `handleSend` 错误恢复代码；AppShell/ChatWindow source contract。React Hook 的状态竞态以浏览器 smoke 覆盖，不新增脆弱的文本模拟框架。
- **Test seam 补充**：必须覆盖 response `sessionId` 对 live/saved 同 ID 不触发迁移，以及 temporary old→new 迁移时 advisor/localStorage/URL/SSE 使用 canonical ID；不能只验证 helper 返回 data。
- **RED**：
  1. 用替换 `globalThis.fetch` 的 node:test 验证 response `{ sessionId: "new-id", data: null }` 会触发 ID 回调并保留 `data` 返回值。
  2. 增加源码合约，确认临时 retry 为 command/SSE 使用可变 active ID、接收新 ID 后更新父级，而不是继续固定旧 `session.id`。
- **Implementation**：
  1. 为 `sendAgentCommand` 添加最小 options 类型；只有 response 中存在不同字符串 `sessionId` 且调用方显式提供 callback 时回调，未知/旧响应不改变行为。
  2. `handleSend` 普通 session 分支将 `session.path === ""` 视为 transient；从 `session.cwd` 仅作为显示/识别依据，cwd/config 恢复由服务端 marker 完成。`get_state`、host/URI 注册、roster 和 prompt 都读取可变 `activeSessionId`，每个 POST 使用同一个迁移 callback。
  3. callback 必须先更新 `sessionIdRef.current`、advisor registry/localStorage、当前 temporary selected row，再更新局部 `activeSessionId`；AppShell 只在旧 ID 与当前 temporary row 匹配时更新对象/URL，不调用 `setSessionKey`，保留消息和输入恢复。
  4. ID 在 prompt POST 前或后变化时，关闭/替换旧 stream，连接新 ID 并触发一次 reconciliation；所有 SSE/reconnect timer 带 run/generation fence，旧 ID 在迁移或删除后不能重连。
  5. 若首条 prompt 失败，保留原文回填输入，清理 optimistic bubble、running/streaming 状态、reconcile timer 和 stale event handlers；成功 recovery 不得重复发送该 prompt。
- **GREEN**：
  - `node --experimental-strip-types --test lib/agent-client.test.mjs lib/api-contract.test.mjs`
- **Validation**：
  - 浏览器手动/自动 smoke：先让首条 prompt 的 OMP child 退出，再点击发送；确认 notice、输入内容、后续发送、SSE 事件和 URL 使用同一可见会话。
- **Dependencies**：Slice 1。
- **Rollback**：回退 helper options、Hook/props 回调；普通已保存会话路径不变，临时恢复仍由服务端存在但旧客户端不会利用新 ID（因此回退前应同时回退 Slice 1 或接受该功能不可见）。

## Slice 3：AC-003/AC-004 —— DELETE 幂等与安全清理

- **Behavior**：saved session 保持原子删除和子会话重挂载；无文件的 live/已退出 temporary session 清理 runtime/metadata 后返回 200；已清理 ID 重复 DELETE 返回幂等成功；已迁移的旧 alias 也能删除同一 canonical session；任何路径都不启动新 wrapper。
- **Code boundary**：
  - `app/api/sessions/[id]/route.ts` DELETE：进入 shared lifecycle lock，canonicalize alias，再由 `resolveSessionPath` 分 saved/temporary/already-deleted。
  - `lib/rpc-manager.ts`：transient/alias cleanup 和 lock API（Slice 1）。
  - `lib/api-contract.test.mjs` 或新增同目录 route/lifecycle 测试。
- **Test seam**：DELETE route 的三路径执行行为；真实 saved-session 文件/artifacts 删除测试；lock 的并发测试；dev server API smoke 验证无文件临时 runtime。source contract 只验证关键调用仍存在。
- **RED**：
  1. 增加 source contract：route 先使用 `resolveSessionPath`/canonical ID，temporary 分支调用 `destroyAndWait`/清理 transient，返回 `temporary`/`alreadyDeleted`，saved 分支仍保留 child re-parent、destroy-before-unlink 和 `deleteSessionFileWithArtifacts`。
  2. 增加可执行的 live temporary、wrapper 已退出、already-deleted 和 concurrent DELETE 测试；至少验证只调用一次 destroy/unlink，DELETE 与 recovery 不能交叉 spawn。
  3. 若 Next route 直接注入不稳定，测试 shared lifecycle helper 的真实状态转换，并在 Slice 5 用实际 API smoke 补齐 route wiring；不能以 source regex 代替并发/文件系统证据。
- **Implementation**：
  1. saved 路径只移动初始 resolution，保留现有 child re-parent 扫描；target 的 `destroyAndWait()` 必须完成后才执行最终 `deleteSessionFileWithArtifacts`。
  2. no-file 路径在 shared lifecycle lock 内取得 canonical `getRpcSession` 和 temporary marker；先标记 deleting，再对 live 或已进入 `destroyPromise` 的 wrapper await `destroyAndWait()`，清理 marker/alias/path/list cache。
  3. shutdown 后重新 resolve canonical path；若文件出现，转入 saved cleanup，不能只返回 temporary。无文件时返回 `{ ok: true, temporary: true }`。
  4. no-file/no-runtime/no-marker 返回 `{ ok: true, alreadyDeleted: true }`；不得调用 `startRpcSession`。
  5. 通过 lock 让 concurrent recovery/DELETE 和两个 DELETE 串行；删除标记阻止 waiting recovery 在删除完成后 spawn。旧 alias DELETE 必须 canonicalize 到同一 runtime。
- **GREEN**：
  - `node --experimental-strip-types --test lib/rpc-manager.test.mjs lib/api-contract.test.mjs lib/session-reader.test.mjs`
- **Validation**：
  - API smoke 覆盖：saved + live child、temporary + live wrapper、temporary wrapper 已退出、重复 DELETE；确认文件/artifacts 不复活，running SSE 终态更新。
- **Dependencies**：Slice 1。
- **Rollback**：只回退 DELETE 分支；saved 行为必须保持原测试通过，temporary DELETE 将回到旧 404。

## Slice 4：AC-005 —— 删除 UI 的即时反馈和父级同步

- **Behavior**：确认删除/归档后按钮立即 disabled、显示 busy 状态并阻止重复请求；失败恢复可点击并 toast；成功回调让侧栏、选中态、URL 和缓存刷新。
- **Code boundary**：
  - `components/SessionSidebar.tsx` `SessionItem`。
  - `lib/i18n/locales/{zh-CN,en,ja}.json`：`sessionSidebar.deleting`（若采用文字状态）。
  - `lib/api-contract.test.mjs`：现有组件 source contract 扩展。
- **Test seam**：DOM/source contract + 浏览器实际交互；不引入新的组件测试框架。
- **RED**：
  - 增加断言要求确认按钮包含 `disabled={deleting}`、`aria-busy` 或等价可访问 busy 状态、deleting 文案/视觉状态，并保留失败 `setDeleting(false)` 和 toast。
- **Implementation**：
  1. 确认按钮增加 disabled、busy 可访问属性和 loading 文案；archive/delete 共享同一行锁。
  2. 保留成功后不恢复本行的策略，因为 `onDeleted` 会移除它；失败时恢复并解析响应 JSON，通过现有 `formatApiError` 显示稳定 code/message，网络异常才回退到本地化通用 toast。
  3. 确认 `SessionSidebar.handleSessionDeleted` 不依赖 `allSessions.find()` 成功才通知父级，临时 optimistic row 也能清除。
- **GREEN**：
  - `node --experimental-strip-types --test lib/api-contract.test.mjs`
- **Validation**：
  - 浏览器慢 DELETE smoke：确认一次请求、按钮 disabled/busy、成功行消失；模拟 500 后按钮恢复且 toast 出现。
- **Dependencies**：Slice 3。
- **Rollback**：回退 SessionItem 和 locale 改动；API 幂等修复独立保留。

## Slice 5：critical 集成、Windows 和最终回归

- **Behavior**：用真实运行链确认 AC-001..AC-005，尤其是 child 退出/恢复、真实 ID 迁移、删除前等待 Windows child tree 退出和缓存/SSE 一致性。
- **Code boundary**：不新增生产边界；补充现有测试/必要的集成 harness。
- **Test seam**：
  - `rpc-manager` lifecycle seam：并发 recovery/DELETE、旧 alias、startup failure cleanup 和 marker TTL/limit；
  - route execution tests：验证真实 response envelope、file/artifact deletion and no-spawn-after-delete；
  - `RpcProcess` 已有 injectable spawn seam，覆盖 child exit/pending command cleanup；
  - `node:test` route/helper contracts；
  - 实际 `npm run dev` + 浏览器 API/UI smoke。
- **RED**：先运行各 slice targeted tests，记录新增断言在实现前的失败；Windows 行为用可控慢退出 fake/手工子进程，不用真实模型网络错误作为唯一证据。并发场景必须用 barrier/deferred promise 明确制造交叉窗口。
- **Implementation**：只修正前四个 slice 暴露的竞态；禁止顺带重构 session reader、RPC 协议或模型网络配置。
- **GREEN / Validation 顺序**：
  1. `node --experimental-strip-types --test lib/rpc-manager.test.mjs lib/omp/rpc-process-runtime.test.mjs lib/agent-client.test.mjs lib/api-contract.test.mjs`
  2. `node --experimental-strip-types --test lib/session-reader.test.mjs lib/session-change-bus.test.mjs components/*.test.mjs hooks/*.test.mjs`
  3. `npm run typecheck`
  4. `npm run lint`
  5. 停止 `npm run dev` 后，若最终门禁需要，再运行 `npm run build`；不得在开发服务器运行时执行。
  6. 启动 `cmd.exe /d /s /c npm run dev`，通过浏览器验证：
     - 首条 prompt 成功后第二条消息仍用同一 ID；
     - 首条 prompt 后 kill OMP child，错误清晰、输入保留、下一次发送恢复；
     - temporary 无文件删除成功；
     - saved live session 删除成功且文件/artifacts 不复活；
     - slow DELETE 期间按钮不可重复点击，失败可恢复。
     - concurrent recovery + DELETE / duplicate DELETE 不产生 replacement spawn、双 unlink 或 resurrected file；
     - ensure_session model/thinking initialization failure 后 registry 无匿名 wrapper，prompt 阶段失败仍可人工重试。
- **Dependencies**：Slices 1–4。
- **Rollback**：测试和 smoke 不改变生产数据；若发现数据完整性风险，停止后续改动，回退最近 slice 并重新运行 saved deletion 与 Windows cleanup 检查。

## 最终 critical 检查表

- [ ] transient metadata 只在无文件 runtime 登记，有 TTL/条目界限并在文件落盘/删除时清理。
- [ ] marker 保存并恢复白名单配置；startup configuration failure 销毁匿名 wrapper，prompt failure 保留人工 retry marker。
- [ ] alias/canonical ID 与 lifecycle lock 覆盖 recovery/delete/late-request；DELETE 不存在双 unlink 或 delete 后 spawn。
- [ ] recovery 不接受任意请求 body cwd，不创建空 JSONL，不重复提交 prompt。
- [ ] recovery 返回真实 OMP ID；Hook、SSE、URL、父级 selectedSession 完成 ID 迁移。
- [ ] 首条失败输入保留，running/streaming 状态和 reconcile timer 归零。
- [ ] saved DELETE 仍为 `destroyAndWait → deleteSessionFileWithArtifacts → invalidate caches`。
- [ ] temporary/already-deleted DELETE 不 spawn；重复调用幂等。
- [ ] Windows `taskkill /t` 完成后才允许 saved 文件删除；慢退出覆盖。
- [ ] 10053 仍作为网络/进程错误展示，不误报 `session_not_found`。
- [ ] targeted tests、typecheck、lint、实际 dev-server/browser smoke 均有记录；build 遵守开发服务器约束。
- [ ] 最终差异经独立 `workflow-reviewer` 审查；发现 material finding 后修复并重跑受影响检查和新一轮 review。
