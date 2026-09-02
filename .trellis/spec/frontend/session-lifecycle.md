# Session Lifecycle Conventions

> Contracts for omp-web's session identity, transient runtimes, deletion, and
> frontend ID migration. Established by task `09-02-session-lifecycle-fixes`;
> all code touching `sessionId`, the RPC registry, or session deletion must
> uphold these invariants.

---

## Identity: the JSONL file is the authority

- A session's identity/history authority is its on-disk JSONL. The RPC
  registry (`globalThis.__ompSessions`) is only valid while the omp child
  lives; in-memory state must never pretend a file exists.
- A brand-new session's JSONL can appear any time between spawn and the first
  accepted prompt. Never fabricate persistence for a file-less id (no empty
  placeholder JSONL — it pollutes the list and races omp's flush).
- omp generates the session id for file-less runtimes; omp-web cannot force a
  specific id on a recovery spawn. Clients must tolerate id migration.

## Transient runtime state (memory-only, bounded)

- File-less runtimes get a transient marker: `{ cwd, toolNames, advisor,
  requestedModel?, thinkingLevel?, expiresAt }` on globalThis (hot-reload
  safe), TTL aligned with `IDLE_DESTROY_MS`, capped entry count with
  oldest-eviction.
- Register a marker ONLY when the runtime is ready and still has no session
  file. The first on-disk confirmation clears it.
- Startup-config failure (model/thinking init in `/api/agent/new`) must
  `destroyAndWait()` + clear the marker — never leave an anonymous live
  wrapper. A prompt-phase failure keeps the marker for manual retry; never
  auto-resend the prompt.
- Recovery reads only the server-side marker (cwd re-validated with
  `statSync(...).isDirectory()`); never accept arbitrary cwd from a POST body.

## Lifecycle lock (one writer per session lifecycle)

- Recovery, DELETE, and late old-id requests must serialize through
  `withSessionLifecycleLock(resolveCanonicalSessionId(id))`.
- Inside the lock: re-check live wrapper / file / marker. After DELETE
  completes, a late recovery must see no marker and yield
  `session_not_found` — a replacement spawn after deletion is forbidden.
- The lock re-queues queued operations onto migrated canonical chains.

## DELETE: three branches, one ordering

- Resolve canonical id → lock → `resolveSessionPath` → branch:
  1. **saved**: child re-parent scan → `destroyAndWait()` →
     `deleteSessionFileWithArtifacts()` → invalidate path/list caches.
     Destroy MUST complete before unlink (omp flushes state on shutdown and
     would recreate the file).
  2. **temporary** (no file, marker or wrapper present): clear marker →
     destroy → re-resolve (a shutdown-flushed file falls through to the SAME
     saved cleanup) → `{ ok: true, temporary: true }`.
  3. **already deleted**: no file/wrapper/marker → `{ ok: true,
     alreadyDeleted: true }`. No branch may call `startRpcSession`.
- DELETE is idempotent; responses distinguish `temporary` / `alreadyDeleted`.

## Frontend ID migration (temporary retry only)

- `sendAgentCommand` accepts `onSessionIdChange(previousId, nextId)`; it fires
  only when the response carries a string `sessionId` different from the
  requested id. Saved-session ids are stable and must never trigger it.
- Migration order: `sessionIdRef.current` → advisor registry +
  `omp-advisor-enabled:*` localStorage key → parent callback (AppShell updates
  the temporary selected row + URL only when `path === ""` and id matches; no
  `setSessionKey`, no remount) → local `activeSessionId`.
- Every POST in the retry flow (get_state, prompt) passes the same callback;
  fire-and-forget registrations read the mutated id after the awaited
  `get_state`.
- On ID change: reconnect SSE on the new id, run one reconciliation; all
  SSE/reconnect timers are fenced by `sessionIdRef.current === sid` so stale
  ids cannot reconnect after migration or deletion.
- First-prompt failure: roll back the optimistic bubble, restore the text via
  `insertIfEmpty`, zero running/streaming state and reconcile timers.

## Error semantics

- `session_not_found` (404) only when there is no file, no live wrapper, AND
  no unexpired marker/alias. RPC/network errors (e.g. Windows 10053) surface
  as command/process errors — never masked as "session not found".
- UI delete/archive failures show the server's actual error via
  `formatApiError`; localized generic toasts are a network-failure fallback.
  The confirm button is `disabled` + `aria-busy` while in-flight; archive and
  delete share one row lock.

## Known residual (documented, accepted)

- File confirmation also drops old→new aliases; a very-late old-id DELETE
  during the recovery→file-landed window can return `alreadyDeleted` while the
  recovered JSONL persists. The client migrates its id in the response
  callback, so the window is negligible.
- Saved-path POST resume does not take the lifecycle lock (pre-existing; the
  saved send-vs-DELETE race predates the lifecycle work).
