import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("agent command routes reject malformed commands and map RPC failures to 400", async () => {
  const route = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const newRoute = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");
  assert.match(route, /command_type_required/);
  assert.match(route, /instanceof RpcCommandError/);
  assert.match(route, /status: 400/);
  assert.match(newRoute, /command_type_required/);
  assert.match(newRoute, /newSessionErrorResponse/);
});

test("interactive login negotiates RPC v2 before sending the login command", async () => {
  const route = await readFile(new URL("../app/api/auth/login/[provider]/route.ts", import.meta.url), "utf8");
  const waitReady = route.indexOf("await child.waitReady(READY_TIMEOUT_MS)");
  const negotiate = route.indexOf("await child.negotiateProtocol(ready)");
  const login = route.indexOf('await child.sendCommand({ type: "login"');

  assert.ok(waitReady >= 0);
  assert.ok(negotiate > waitReady);
  assert.ok(login > negotiate);
});

test("session archive route stops live children and maps missing sessions", async () => {
  const route = await readFile(new URL("../app/api/sessions/[id]/archive/route.ts", import.meta.url), "utf8");
  const utils = await readFile(new URL("../lib/api-utils.ts", import.meta.url), "utf8");
  assert.match(route, /destroyAndWait/);
  assert.match(route, /archiveSessionFileWithArtifacts/);
  // Missing-session responses now come from the shared helper.
  assert.match(route, /resolveSessionPathOr404/);
  assert.match(utils, /session_not_found/);
  assert.match(route, /session_archive_failed/);
  assert.match(route, /session_has_children/);
});

test("session archive remains keyboard-discoverable with an ARIA label", async () => {
  const source = await readFile(new URL("../components/SessionSidebar.tsx", import.meta.url), "utf8");
  assert.match(source, /api\/sessions\/\$\{encodeURIComponent\(session\.id\)\}\/archive/);
  assert.match(source, /sessionSidebar\.archiveLeafOnly/);
  assert.match(source, /sessionSidebar\.archiveConfirm/);
});

test("prompt controls preserve abort, steer, and follow-up RPC commands", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(source, /case "abort":/);
  assert.match(source, /case "steer":/);
  assert.match(source, /case "follow_up":/);
  assert.match(source, /streamingBehavior/);
});

test("worktree discovery filters prunable entries and identifies the main checkout", async () => {
  const source = await readFile(new URL("./worktree.ts", import.meta.url), "utf8");
  assert.match(source, /current\.prunable/);
  assert.match(source, /isMain: worktrees\.length === 0/);
  assert.match(source, /"worktree", "list", "--porcelain"/);
});

test("OMP update route permits check and restart actions with force support", async () => {
  const route = await readFile(new URL("../app/api/omp-update/route.ts", import.meta.url), "utf8");
  const settings = await readFile(new URL("../components/SettingsConfig.tsx", import.meta.url), "utf8");
  const appShell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");

  assert.match(route, /body\.action === "check"/);
  assert.match(route, /checkOmpUpdate\(body\.force === true\)/);
  assert.match(route, /body\.action === "restart"/);
  assert.match(route, /restartAllRpcSessions/);

  // Settings manual refresh passes force: true; auto check uses cached default
  assert.match(settings, /checkForUpdate\(true\)/);
  assert.match(settings, /force:\s*true/);
  assert.match(settings, /force = false/);
  assert.match(appShell, /fetch\("\/api\/omp-update"[\s\S]*?action:\s*"check"/);
  assert.doesNotMatch(appShell, /force:\s*true/);
});

test("settings groups runtime preferences and resource managers behind tabs", async () => {
  const settings = await readFile(new URL("../components/SettingsConfig.tsx", import.meta.url), "utf8");
  const models = await readFile(new URL("../components/ModelsConfig.tsx", import.meta.url), "utf8");
  const appShell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(settings, /settingsConfig\.runAppUpdateCommand/);
  assert.match(settings, /settingsConfig\.restartSessions/);
  assert.match(appShell, /appShell\.ompUpdateAvailable/);
  assert.match(appShell, /appShell\.appUpdateAvailable/);
  assert.match(appShell, /appShell\.updateVersion/);
  assert.match(appShell, /appShell\.copyCommand/);
  assert.match(appShell, /appShell\.commandCopied/);
  assert.match(appShell, /appShell\.commandCopyFailed/);
  assert.match(settings, /currentTab === "models"/);
  assert.match(settings, /currentTab === "skills"/);
  assert.match(settings, /currentTab === "plugins"/);
  assert.doesNotMatch(settings, /visitedTabs/);
  assert.match(settings, /<ModelsConfig embedded/);
  assert.match(models, /fetch\("\/api\/models", \{ cache: "no-store" \}\)/);
  assert.match(models, /OMP runtime models/);
});

test("model endpoint invalidates cached runtime models after external config edits", async () => {
  const route = await readFile(new URL("../app/api/models/route.ts", import.meta.url), "utf8");
  assert.match(route, /statSync/);
  assert.match(route, /__ompModelsConfigFingerprint/);
  assert.match(route, /invalidateModelsCache\(\)/);
  assert.match(route, /disposeUtilityRpc\(\)/);
});

test("agent project discovery requires an explicit workspace", async () => {
  const route = await readFile(new URL("../app/api/agents/route.ts", import.meta.url), "utf8");
  assert.match(route, /scope === "project" && !cwdParam/);
  assert.match(route, /cwd is required for project scope/);
});

test("agent mutations bound JSON input before parsing", async () => {
  const route = await readFile(new URL("../app/api/agents/route.ts", import.meta.url), "utf8");
  assert.match(route, /parseJsonWithinLimit/);
  assert.match(route, /MAX_AGENT_REQUEST_BYTES/);
  assert.match(route, /RequestBodyTooLargeError/);
  assert.match(route, /status: 413/);
  assert.doesNotMatch(route, /request\.json\(\)/);
});

test("mutating agent and MCP routes bound JSON input", async () => {
  const newAgent = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");
  const agent = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const mcp = await readFile(new URL("../app/api/mcp/route.ts", import.meta.url), "utf8");
  for (const route of [newAgent, agent, mcp]) {
    assert.match(route, /parseJsonWithinLimit/);
    assert.match(route, /RequestBodyTooLargeError/);
  }
  assert.match(newAgent, /status: 413/);
  assert.match(agent, /status: 413/);
  assert.match(mcp, /\? 413 : 400/);
});

test("agent routes bound requests with the shared attachment budget", async () => {
  const newAgent = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");
  const agent = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const budget = await readFile(new URL("./image-attachments.ts", import.meta.url), "utf8");

  // One source of truth: the composer preflights against the same constant, so
  // a per-route literal would let the client send bodies the route rejects.
  for (const route of [newAgent, agent]) {
    assert.match(route, /import \{ MAX_AGENT_COMMAND_REQUEST_BYTES \} from "@\/lib\/image-attachments"/);
    assert.match(route, /parseJsonWithinLimit<[^>]*>\(req, MAX_AGENT_COMMAND_REQUEST_BYTES\)/);
    assert.doesNotMatch(route, /REQUEST_BYTES = /);
  }
  // Below Next's 10 MB proxy buffering boundary, with base64 headroom for the
  // aggregate image cap.
  assert.match(budget, /MAX_AGENT_COMMAND_REQUEST_BYTES = 8 \* 1024 \* 1024/);
  assert.match(budget, /MAX_TOTAL_ATTACHED_IMAGE_BYTES = 5 \* 1024 \* 1024/);
});

test("MCP route redacts project server credentials", async () => {
  const route = await readFile(new URL("../app/api/mcp/route.ts", import.meta.url), "utf8");
  assert.match(route, /redactMcpServer\(config\)/);
  assert.doesNotMatch(route, /config }\)\), user: safeUser/);
});

test("event streams observe only existing web-managed sessions", async () => {
  const route = await readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8");
  assert.match(route, /getRpcSession\(resolveCanonicalSessionId\(id\)\)/);
  assert.match(route, /Session is not managed by omp-web/);
  assert.doesNotMatch(route, /startRpcSession/);
});

test("agent command route forwards the advisor choice to lazy spawns via query param", async () => {
  const route = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  assert.match(route, /searchParams\.get\("advisor"\) === "1"/);
  assert.match(route, /startRpcSession\(lockCanonicalId, lockFilePath, cwd, undefined, advisor/);
  // The RPC body goes to omp verbatim; the flag must never ride inside it.
  assert.match(route, /existing\.send\(body\)/);
});

test("agent command route recovers file-less temporary sessions from server-side markers", async () => {
  const route = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");

  // Late requests carrying a pre-recovery id resolve to the same lifecycle object.
  assert.match(route, /resolveCanonicalSessionId\(id\)/);
  assert.match(route, /getTemporarySession\(canonicalId\)/);
  assert.match(route, /const recovered = await withSessionLifecycleLock\(id, async \(\) => \{/);
  // Recovery spawns a file-less runtime from the marker's recorded startup
  // config — never a cwd taken from the request body.
  assert.match(route, /startRpcSession\(canonicalId, "", marker\.cwd, marker\.toolNames, advisor\)/);
  // Confirmed model/thinking config is restored before the original command.
  assert.match(route, /marker\.requestedModel/);
  assert.match(route, /marker\.thinkingLevel/);
  // The recorded cwd is re-validated as a real directory before spawning.
  assert.match(route, /statSync\(marker\.cwd\)\.isDirectory\(\)/);
  // A failed config restore must not leave a second half-alive runtime.
  assert.match(route, /destroyAndWait\(\);\s*\n\s*throw error/);
  // All three success paths report the real session id; recovery is flagged.
  assert.match(route, /sessionId: existing\.sessionId \|\| canonicalId/);
  assert.match(route, /sessionId: saved\.realSessionId/);
  // Recovery and live paths also return the current real id.
  assert.match(route, /sessionId: recovered\.realSessionId/);
  assert.match(route, /sessionId: existing\.sessionId \|\| canonicalId/);
  assert.match(route, /sessionId: recovered\.realSessionId/);
  assert.match(route, /recovered: true/);
  // session_not_found only when there is no file, no live wrapper, and no
  // unexpired marker/alias.
  assert.match(route, /code: "session_not_found"/);
  assert.doesNotMatch(route, /body\.cwd/);
});

test("agent/new validates cwd, whitelists startup config, and cleans up init failures", async () => {
  const newRoute = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  // The startup cwd must be a real directory, not merely an existing path.
  assert.match(newRoute, /statSync\(cwd\)\.isDirectory\(\)/);
  // Model/thinking initialization failure destroys the created wrapper and
  // drops the transient marker — no anonymous orphan runtime survives.
  assert.match(newRoute, /await session\.destroyAndWait\(\)/);
  assert.match(newRoute, /clearTemporarySession\(realSessionId\)/);
  // Confirmed startup config is whitelisted into the transient marker.
  assert.match(newRoute, /updateTemporarySessionConfig\(realSessionId, \{ requestedModel/);
  assert.match(newRoute, /updateTemporarySessionConfig\(realSessionId, \{ thinkingLevel/);
  // Prompt-phase failures keep the marker for manual retry (no auto-resend).
  assert.match(newRoute, /ensure_session/);
});

test("temporary retry re-keys the whole send flow onto the recovered runtime id", async () => {
  const hook = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const shell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  const chat = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");

  // Option + prop plumbing: hook option, ChatWindow prop passthrough, AppShell handler.
  assert.match(hook, /onSessionIdChanged\?:/);
  assert.match(chat, /onSessionIdChanged\?:/);
  assert.match(chat, /onSessionIdChanged,/);
  assert.match(shell, /onSessionIdChanged=\{handleSessionIdChanged\}/);

  // Transient rows (no JSONL on disk yet) retry through a mutable active id.
  assert.match(hook, /session\.path === ""/);
  assert.match(hook, /let activeSessionId = session\.id;/);
  // get_state and the prompt POST both carry the same migration callback.
  assert.match(hook, /sendAgentCommand\(activeSessionId, \{ type: "get_state" \}, \{ onSessionIdChange \}\)/);
  assert.match(hook, /sendAgentCommand\(activeSessionId, \{\s*\n\s*type: "prompt",[\s\S]*?\}, \{ onSessionIdChange \}\)/);

  // Migration order: fencing ref first, advisor identity, parent callback,
  // then the local mutable id for later POSTs in the same flow.
  const migrateStart = hook.indexOf("const migrateToNewRuntimeId = ");
  const migrateEnd = hook.indexOf("sentSessionId = activeSessionId", migrateStart);
  assert.ok(migrateStart >= 0 && migrateEnd > migrateStart, "the send flow must define a sessionId migration callback");
  const migrate = hook.slice(migrateStart, migrateEnd);
  assert.match(migrate, /sessionIdRef\.current = nextId;/);
  assert.match(migrate, /setSessionAdvisorSpawn\(nextId,/);
  assert.match(migrate, /onSessionIdChanged\?\.\(/);
  assert.match(migrate, /activeSessionId = nextId;/);
  const pos = (re) => migrate.search(re);
  assert.ok(pos(/sessionIdRef\.current = nextId;/) < pos(/setSessionAdvisorSpawn\(nextId,/));
  assert.ok(pos(/setSessionAdvisorSpawn\(nextId,/) < pos(/onSessionIdChanged\?\.\(/));
  assert.ok(pos(/onSessionIdChanged\?\.\(/) < pos(/activeSessionId = nextId;/));

  // Advisor identity follows the migration (registry + localStorage key).
  assert.match(migrate, /omp-advisor-enabled:/);

  // A runtime id change around the prompt POST replaces the SSE stream and
  // triggers exactly one reconciliation.
  assert.match(hook, /activeSessionId !== session\.id/);
  assert.match(hook, /ensureEventsConnected\(activeSessionId\)/);
  assert.match(hook, /void reconcileAgentState\(activeSessionId\)/);

  // The SSE reconnect timer keeps its existing session fence so a stale id
  // cannot reconnect after migration or deletion.
  assert.match(hook, /sessionIdRef\.current === sid/);

  // AppShell follows the id only for a still-selected temporary row; no
  // remount and no message clearing (no setSessionKey call in the handler).
  const handlerStart = shell.indexOf("const handleSessionIdChanged");
  assert.ok(handlerStart >= 0, "AppShell must implement handleSessionIdChanged");
  const handler = shell.slice(handlerStart, shell.indexOf("}, [", handlerStart));
  assert.match(handler, /path !== ""/);
  assert.match(handler, /selectedSession\.id !== previousId/);
  assert.match(handler, /router\.replace\(`\?session=/);
  assert.doesNotMatch(handler, /setSessionKey/);
});

test("DELETE resolves under the lifecycle lock with saved/temporary/already-deleted branches", async () => {
  const route = await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
  const deleteStart = route.indexOf("export async function DELETE");
  const deleteBody = route.slice(deleteStart);

  // Old alias ids must hit the same lifecycle object; the whole delete is
  // serialized per canonical session id.
  assert.match(route, /const canonicalId = resolveCanonicalSessionId\(id\);/);
  assert.match(deleteBody, /withSessionLifecycleLock\(id, async \(\) => \{/);
  // Resolution happens inside the lock — no immediate 404: temporary sessions
  // (marker/wrapper, no file yet) delete differently.
  assert.match(deleteBody, /await resolveSessionPath\(canonicalId\)/);
  assert.doesNotMatch(deleteBody, /resolveSessionPathOr404/);

  // temporary branch: clear the marker BEFORE destroying (blocks a queued
  // recovery from spawning), join the in-flight destroy, re-resolve for a
  // shutdown-flushed file, then the same saved cleanup.
  assert.match(deleteBody, /clearTemporarySession\(canonicalId\)/);
  assert.match(deleteBody, /destroyAndWait/);
  assert.match(deleteBody, /flushedPath/);
  assert.match(deleteBody, /deleteSavedSession\(flushedPath, canonicalId\)/);
  assert.match(deleteBody, /ok: true, temporary: true/);
  assert.match(deleteBody, /ok: true, alreadyDeleted: true/);

  // saved path keeps the child re-parent scan and the strict
  // destroyAndWait-before-unlink order; caches invalidated after deletion.
  const helperStart = route.indexOf("async function deleteSavedSession");
  assert.ok(helperStart >= 0, "the saved deletion must be an extracted helper");
  const helper = route.slice(helperStart, deleteStart);
  const destroyPos = helper.indexOf("await getRpcSession(canonicalId)?.destroyAndWait?.()");
  const unlinkPos = helper.indexOf("deleteSessionFileWithArtifacts(filePath)");
  assert.ok(destroyPos >= 0, "the target wrapper must be awaited via destroyAndWait");
  assert.ok(unlinkPos > destroyPos, "the file must be unlinked only after the child exited");
  assert.match(helper, /skippedChildren/);
  assert.match(helper, /writeSessionFileAtomicSync/);
  assert.match(helper, /invalidateSessionPathCache\(canonicalId\)/);
  assert.match(helper, /invalidateSessionListCache\(\)/);

  // No DELETE path may spawn a replacement wrapper.
  assert.doesNotMatch(deleteBody, /startRpcSession/);
  assert.doesNotMatch(helper, /startRpcSession/);

  // GET/PATCH keep their 404 semantics (only DELETE becomes idempotent).
  assert.match(route, /resolveSessionPathOr404/);

  // A waiting recovery must re-check the marker INSIDE the lock so a
  // completed delete cannot be followed by a replacement spawn.
  const agentRoute = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const recoveryLockPos = agentRoute.indexOf("const recovered = await withSessionLifecycleLock");
  const recheckPos = agentRoute.indexOf("getTemporarySession(canonicalId)", recoveryLockPos);
  assert.ok(recoveryLockPos >= 0 && recheckPos > recoveryLockPos, "recovery must re-check the marker inside the lifecycle lock");
  assert.match(agentRoute, /if \(!recovered\)/);
});

test("session rows give immediate busy feedback on delete/archive and always notify the parent", async () => {
  const source = await readFile(new URL("../components/SessionSidebar.tsx", import.meta.url), "utf8");
  const itemStart = source.indexOf("const [deleting, setDeleting] = useState(false)");
  assert.ok(itemStart >= 0, "SessionItem must own the deleting row state");
  const item = source.slice(itemStart);

  // The confirm button is disabled + aria-busy while the request is in flight,
  // so a double-click cannot fire a second DELETE.
  assert.match(item, /disabled=\{deleting\}/);
  assert.match(item, /aria-busy=\{deleting\}/);
  // A visible busy label replaces the confirm text while in flight.
  assert.match(item, /deleting \? t\("sessionSidebar\.deleting"\)/);

  // Archive and delete share the same row lock: re-entry is refused.
  assert.ok(
    (item.match(/if \(deleting\) return;/g) || []).length >= 2,
    "handleArchive and handleDelete must both guard re-entry with the shared lock",
  );

  // Failure path: restore the button and toast the ACTUAL server error
  // (formatApiError over the parsed response body); network-level failures
  // fall back to the localized generic toast.
  const deleteStart = item.indexOf("const handleDelete = useCallback");
  const deleteHandler = item.slice(deleteStart, item.indexOf("}, [deleting", deleteStart));
  assert.ok(deleteHandler.length > 0, "handleDelete must be found");
  assert.match(deleteHandler, /setDeleting\(false\)/);
  assert.match(deleteHandler, /formatApiError\(/);
  assert.match(deleteHandler, /sessionSidebar\.deleteFailed/);
  const archiveStart = item.indexOf("const handleArchive = useCallback");
  const archiveHandler = item.slice(archiveStart, item.indexOf("}, [deleting", archiveStart));
  assert.match(archiveHandler, /setDeleting\(false\)/);
  assert.match(archiveHandler, /formatApiError\(/);
  assert.match(archiveHandler, /sessionSidebar\.archiveFailed/);

  // Success never restores the row: onDeleted fires and the parent removes it.
  assert.match(deleteHandler, /onDeleted\?\.\(session\.id\)/);

  // The sidebar parent notifies AppShell even when the id is not in
  // allSessions (temporary optimistic rows must clear too).
  const parentStart = source.indexOf("const handleSessionDeleted = useCallback");
  const parent = source.slice(parentStart, source.indexOf("}, [", parentStart));
  assert.match(parent, /allSessions\.find/);
  assert.match(parent, /onSessionDeleted\?\.\(id\);/);
  assert.doesNotMatch(parent, /if \(!deleted\) return/);

  // The deleting label exists in all three locales (flat keys).
  for (const locale of ["zh-CN", "en", "ja"]) {
    const text = await readFile(new URL(`../lib/i18n/locales/${locale}.json`, import.meta.url), "utf8");
    assert.match(text, /"sessionSidebar\.deleting"\s*:/, `${locale} must define sessionSidebar.deleting`);
  }
});

test("reviewer M1: route bodies re-resolve the canonical id INSIDE the lifecycle lock", async () => {
  const sessionsRoute = await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
  const agentRoute = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");

  // DELETE: the lock is acquired with the raw request id and the canonical id
  // is resolved at execution time — a prior holder (in-flight recovery) may
  // migrate the id while this delete waits, so the re-queued body must probe
  // the migrated runtime, not the stale id.
  const delStart = sessionsRoute.indexOf("export async function DELETE");
  const delBody = sessionsRoute.slice(delStart);
  assert.match(delBody, /withSessionLifecycleLock\(id, async \(\) => \{/);
  const delCallback = delBody.slice(delBody.indexOf("withSessionLifecycleLock(id"));
  assert.match(delCallback, /const canonicalId = resolveCanonicalSessionId\(id\);/);
  assert.doesNotMatch(delBody.slice(0, delBody.indexOf("withSessionLifecycleLock(id")), /resolveCanonicalSessionId\(id\)/);

  // Temporary recovery: same contract — canonicalize inside the lock callback.
  const recoveryStart = agentRoute.indexOf("const recovered = await withSessionLifecycleLock");
  const recoveryBody = agentRoute.slice(recoveryStart, agentRoute.indexOf("if (!recovered) {"));
  assert.match(recoveryBody, /const canonicalId = resolveCanonicalSessionId\(id\);/);
});

test("reviewer M2: the saved-path spawn runs under the lifecycle lock with in-lock re-checks", async () => {
  const agentRoute = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");

  // The saved path's resolve+spawn must be serialized against a concurrent
  // DELETE so a fresh --resume child can never overtake the unlink.
  const savedLock = agentRoute.indexOf("withSessionLifecycleLock(id, async () => {", agentRoute.indexOf("// Saved path"));
  assert.ok(savedLock > 0, "saved path must acquire the lifecycle lock before spawning");
  const savedBody = agentRoute.slice(savedLock, agentRoute.indexOf("// Temporary recovery path"));
  assert.match(savedBody, /const lockCanonicalId = resolveCanonicalSessionId\(id\);/);
  assert.match(savedBody, /getRpcSession\(lockCanonicalId\)/);
  assert.match(savedBody, /resolveSessionPath\(lockCanonicalId\)/);
  assert.match(savedBody, /startRpcSession\(lockCanonicalId, lockFilePath/);
});

test("reviewer M3: saved DELETE clears a coexisting temporary marker", async () => {
  const sessionsRoute = await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
  const savedStart = sessionsRoute.indexOf("async function deleteSavedSession");
  const savedBody = sessionsRoute.slice(savedStart, sessionsRoute.indexOf("export async function DELETE"));
  // destroyAndWait → clearTemporarySession → deleteSessionFileWithArtifacts
  const destroy = savedBody.indexOf("destroyAndWait");
  const clear = savedBody.indexOf("clearTemporarySession(canonicalId)");
  const unlink = savedBody.indexOf("deleteSessionFileWithArtifacts(filePath)");
  assert.ok(destroy > 0, "destroyAndWait must run before unlink");
  assert.ok(clear > destroy, "the coexisting marker must be cleared after destroy");
  assert.ok(unlink > clear, "unlink must come after the marker clear");
});
