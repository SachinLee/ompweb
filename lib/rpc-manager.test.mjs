import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// rpc-manager.ts drives the user's `omp` binary over NDJSON (lib/omp/rpc-process)
// instead of embedding a Bun-only SDK. These are source-contract tests (the
// module cannot be imported from .mjs without a TS loader).

test("rpc-manager spawns omp via RpcProcess and has no SDK imports", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  assert.match(source, /from "\.\/omp\/rpc-process"/);
  assert.doesNotMatch(source, /@earendil-works/);
  assert.doesNotMatch(source, /@oh-my-pi/);
});

test("session startup negotiates RPC v2 when the installed OMP advertises it", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(source, /await this\.proc\.negotiateProtocol\(ready\)/);
  assert.match(source, /await proc\.negotiateProtocol\(ready\)/);
});

test("registered host tools route to listeners; unknown ones are rejected", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  // Registered host tools (set_host_tools) are forwarded to attached UI
  // listeners, which answer with host_tool_result.
  assert.match(source, /case "host_tool_call":/);
  assert.match(source, /this\.hostToolNames\.has\(toolName\)/);
  assert.match(source, /this\.pendingHostTools\.set\(id, event\)/);
  assert.match(source, /case "set_host_tools":/);
  assert.match(source, /case "host_tool_result":/);
  // Unregistered tools / no attached listener are settled with an error so
  // the agent turn cannot hang waiting for a response.
  assert.match(source, /type: "host_tool_result"/);
  assert.match(source, /isError: true/);
  // A disconnected UI rejects outstanding host tool calls.
  assert.match(source, /rejectPendingHostTools\(/);
  assert.match(source, /listeners\.length === 0/);
});

test("registered host URI schemes route to listeners; unknown schemes are rejected", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  // Registered schemes (set_host_uri_schemes) forward host_uri_request frames
  // to attached UI listeners, which answer with host_uri_result.
  assert.match(source, /case "set_host_uri_schemes":/);
  assert.match(source, /case "host_uri_request":/);
  assert.match(source, /case "host_uri_result":/);
  assert.match(source, /this\.hostUriSchemes\.get\(scheme\)/);
  assert.match(source, /registered\.writable/);
  // Unknown schemes / no listener get an error result so read/write never hangs.
  assert.match(source, /isError: true,\s*\n\s*error: `URI scheme/);
  // A disconnected UI rejects outstanding URI requests too.
  assert.match(source, /rejectPendingHostUris\(/);
});

test("RPC process cleanup reaps Windows child trees as well as POSIX groups", async () => {
  const source = await readFile(new URL("./omp/rpc-process.ts", import.meta.url), "utf8");
  assert.match(source, /process\.platform === "win32"/);
  assert.match(source, /taskkill/);
  assert.match(source, /process\.kill\(-pid/);
});

test("existing sessions resume deterministically via --resume <file>", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const spawnArgs = source.slice(
    source.indexOf("export function buildSessionSpawnArgs"),
    source.indexOf("function toImageContents"),
  );

  assert.match(spawnArgs, /"--resume", sessionFile/);
  assert.match(spawnArgs, /"--no-tools"/);
  assert.match(spawnArgs, /"--tools"/);
  assert.match(spawnArgs, /if \(advisor\) args\.push\("--advisor"\)/);
  assert.match(spawnArgs, /"--advisor"/);
});

test("pi tool preset names translate to omp builtin names", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  // omp renamed find->glob and dropped ls (tools/builtin-names.ts).
  assert.match(source, /find: "glob"/);
  assert.match(source, /DROPPED_TOOL_NAMES = new Set\(\["ls"\]\)/);
});

test("commands with no omp equivalent fail with a clear unsupported error", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const unsupported = source.slice(
    source.indexOf("const UNSUPPORTED_COMMANDS"),
    source.indexOf("const TOOL_NAME_ALIASES"),
  );

  for (const command of ["navigate_tree", "clear_queue", "get_tools", "set_tools"]) {
    assert.match(unsupported, new RegExp(`${command}:`));
  }
});

test("prompt completion is driven by agent_end / prompt_result, not prompt_done", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  assert.match(source, /case "prompt_result":/);
  assert.match(source, /isTerminal !== false/);
  assert.doesNotMatch(source, /"prompt_done"/);
});

test("agent startup broadcasts a session-list refresh without waiting for a reply", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const agentStart = source.slice(source.indexOf('case "agent_start":'), source.indexOf('case "agent_end":'));

  assert.match(agentStart, /invalidateSessionListCache\(\)/);
  assert.match(agentStart, /refreshSessionList = true/);
  assert.match(source, /notifyRunningChange\(\{ refreshSessionList \}\)/);
  assert.match(source, /snapshot === lastRunningSnapshot && !refreshSessionList/);
});

test("live MCP status uses only OMP's local /mcp list command", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const method = source.slice(source.indexOf("async getMcpList()"), source.indexOf("private buildWebState"));

  assert.match(method, /message: "\/mcp list"/);
  assert.match(method, /mcp_list_timeout/);
  assert.match(source, /case "command_output":/);
  assert.match(source, /Wait for the current run to finish/);
});

test("`!!` shell commands are rejected instead of silently entering context", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const bashCase = source.slice(source.indexOf('case "bash": {'), source.indexOf("default: {"));

  // omp's RPC bash is `{type:"bash", command}` only — there is no exclusion
  // option, so honoring `!!` is impossible and must fail loudly.
  assert.match(bashCase, /command\.excludeFromContext === true/);
  assert.match(bashCase, /WebRpcError\(BASH_EXCLUDE_MESSAGE, "bash_exclude_unsupported"\)/);
  assert.doesNotMatch(bashCase, /excludeFromContext: /);
});

test("auto-compaction results carry the same estimatedTokensAfter as manual compact", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const autoCase = source.slice(
    source.indexOf('case "auto_compaction_end":'),
    source.indexOf('case "session_info_update":'),
  );

  assert.match(autoCase, /patchEstimatedTokensAfter\(event\.result\)/);
  // Both paths must go through the one estimator, not duplicate the formula.
  assert.equal(source.match(/estimatedTokensAfter = Math\.round/g)?.length, 1);
});

test("timed-out extension dialogs are not replayed on reconnect", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const onEvent = source.slice(source.indexOf("onEvent(listener: EventListener)"), source.indexOf("onDestroy(cb:"));

  assert.match(onEvent, /expiresAt !== undefined && expiresAt <= now/);
  assert.match(onEvent, /this\.forgetPendingUiRequest\(id\)/);
  // The expiry also fires on its own so a long-lived session stops holding it.
  assert.match(source, /setTimeout\(\(\) => this\.forgetPendingUiRequest\(id\), timeout\)/);
});

test("restart rejects concurrent commands and disposes a failed replacement", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const restart = source.slice(source.indexOf("private async restart()"), source.indexOf("async send(command"));

  assert.match(restart, /if \(this\.restarting\) throw new WebRpcError\(RESTARTING_MESSAGE, "session_restarting"\)/);
  assert.match(restart, /void proc\.dispose\(\)/);
  // send() must refuse while the child is being swapped out.
  const send = source.slice(source.indexOf("async send(command"), source.indexOf('case "prompt": {'));
  assert.match(send, /if \(this\.restarting\) throw new WebRpcError\(RESTARTING_MESSAGE, "session_restarting"\)/);
});

test("restart restores the subagent event subscription before reading replacement state", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const restart = source.slice(source.indexOf("private async restart()"), source.indexOf("async send(command"));
  const subscription = restart.indexOf('type: "set_subagent_subscription", level: "events"');
  const state = restart.indexOf('type: "get_state"');

  assert.ok(subscription >= 0, "restart must restore subagent subscription");
  assert.ok(state >= 0, "restart must read replacement state");
  assert.ok(subscription < state, "subscription must be restored before replacement state is read");
});

test("resolveSpawnCwd uses the recorded directory when it exists, falls back otherwise", async () => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  const { resolveSpawnCwd, resolveSpawnCwdResult } = jiti("./rpc-manager.ts");
  const { existsSync } = await import("node:fs");

  // A live recorded cwd is used verbatim — no fallback.
  const live = process.cwd();
  assert.equal(resolveSpawnCwd(live), live);
  assert.deepEqual(resolveSpawnCwdResult(live), { cwd: live, fellBack: false });

  // A missing recorded cwd falls back to a live directory and reports it.
  const missing = "/nonexistent/path/that/should/not/exist";
  const result = resolveSpawnCwdResult(missing);
  assert.equal(result.fellBack, true);
  assert.ok(existsSync(result.cwd), "fallback cwd must exist on disk");

  // The second-tier fallback is process.cwd() (which exists in normal environments);
  // resolveSpawnCwd (string return) matches the result's cwd.
  assert.equal(result.cwd, process.cwd());
  assert.equal(resolveSpawnCwd(missing), process.cwd());

  // undefined/empty also falls back.
  assert.equal(resolveSpawnCwdResult(undefined).fellBack, true);
  assert.equal(resolveSpawnCwd(undefined), process.cwd());
});

test("missing terminal agent_end clears isPromptRunning on raw idle get_state", async () => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  const { AgentSessionWrapper } = jiti("./rpc-manager.ts");

  let frameListener = null;
  const fakeProc = {
    isAlive: true,
    onFrame(listener) {
      frameListener = listener;
      return () => { frameListener = null; };
    },
    sendCommand: async (command) => {
      if (command.type === "prompt") return { agentInvoked: true };
      if (command.type === "get_state") {
        return {
          sessionId: "test-session-1",
          sessionFile: "/tmp/session.jsonl",
          isStreaming: false,
          isCompacting: false,
        };
      }
      return {};
    },
    sendFrame: () => {},
    dispose: async () => {},
  };

  const wrapper = new AgentSessionWrapper(fakeProc, process.cwd());
  wrapper.start();

  await wrapper.send({ type: "prompt", message: "Hello" });
  frameListener({ type: "agent_start" });
  assert.equal(wrapper.isRunning(), true);

  // Missing agent_end frame — get_state reports raw idle
  const state = await wrapper.send({ type: "get_state" });
  assert.equal(state.isPromptRunning, false);
  assert.equal(wrapper.isRunning(), false);
  await wrapper.destroyAndWait();
});

test("prompt ack pending does not let raw idle get_state clear promptRunning", async () => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  const { AgentSessionWrapper } = jiti("./rpc-manager.ts");

  let resolvePromptAck;
  const fakeProc = {
    isAlive: true,
    onFrame: () => () => {},
    sendCommand: async (command) => {
      if (command.type === "prompt") {
        return new Promise((resolve) => { resolvePromptAck = resolve; });
      }
      if (command.type === "get_state") {
        return {
          sessionId: "test-session-2",
          isStreaming: false,
          isCompacting: false,
        };
      }
      return {};
    },
    sendFrame: () => {},
    dispose: async () => {},
  };

  const wrapper = new AgentSessionWrapper(fakeProc, process.cwd());
  wrapper.start();

  const promptPromise = wrapper.send({ type: "prompt", message: "Hello" });
  assert.equal(wrapper.isRunning(), true);

  // While prompt ack is still pending, get_state must not clear isPromptRunning
  const state = await wrapper.send({ type: "get_state" });
  assert.equal(state.isPromptRunning, true);
  assert.equal(wrapper.isRunning(), true);

  resolvePromptAck({ agentInvoked: true });
  await promptPromise;
  await wrapper.destroyAndWait();
});

test("isTerminal:false respects 2-second grace period before raw idle can clear prompt", async () => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  const { AgentSessionWrapper } = jiti("./rpc-manager.ts");

  let frameListener = null;
  const fakeProc = {
    isAlive: true,
    onFrame(listener) {
      frameListener = listener;
      return () => { frameListener = null; };
    },
    sendCommand: async (command) => {
      if (command.type === "prompt") return { agentInvoked: true };
      if (command.type === "get_state") {
        return {
          sessionId: "test-session-3",
          isStreaming: false,
          isCompacting: false,
        };
      }
      return {};
    },
    sendFrame: () => {},
    dispose: async () => {},
  };

  const wrapper = new AgentSessionWrapper(fakeProc, process.cwd());
  wrapper.start();

  await wrapper.send({ type: "prompt", message: "Hello" });
  frameListener({ type: "agent_start" });
  frameListener({ type: "agent_end", isTerminal: false });

  // Within the grace period, raw idle does not clear promptRunning
  const stateDuringGrace = await wrapper.send({ type: "get_state" });
  assert.equal(stateDuringGrace.isPromptRunning, true);

  // After grace period expires, raw idle clears promptRunning
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 3000;
    const stateAfterGrace = await wrapper.send({ type: "get_state" });
    assert.equal(stateAfterGrace.isPromptRunning, false);
    assert.equal(wrapper.isRunning(), false);
  } finally {
    Date.now = realNow;
  }
  await wrapper.destroyAndWait();
});

test("abort_and_prompt images go through the same server-side validation as prompt", async () => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  const { AgentSessionWrapper } = jiti("./rpc-manager.ts");

  let forwarded = false;
  const fakeProc = {
    isAlive: true,
    onFrame: () => () => {},
    sendCommand: async () => { forwarded = true; return {}; },
    sendFrame: () => {},
    dispose: async () => {},
  };

  const wrapper = new AgentSessionWrapper(fakeProc, process.cwd());
  wrapper.start();

  await assert.rejects(
    wrapper.send({ type: "abort_and_prompt", message: "Hi", images: [{ type: "text", text: "nope" }] }),
    /Each attachment must be an image/,
  );
  assert.equal(forwarded, false, "an invalid attachment must never reach omp");
  await wrapper.destroyAndWait();
});

test("get_state timeout recycles wrapper and produces session_unresponsive WebRpcError", async () => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  const { AgentSessionWrapper, WebRpcError } = jiti("./rpc-manager.ts");
  const { RpcCommandTimeoutError } = jiti("./omp/rpc-process.ts");

  let disposed = false;
  const fakeProc = {
    isAlive: true,
    onFrame: () => () => {},
    sendCommand: async (command, timeoutMs) => {
      if (command.type === "get_state") {
        assert.equal(timeoutMs, 5000);
        throw new RpcCommandTimeoutError("get_state", 5000);
      }
      return {};
    },
    sendFrame: () => {},
    dispose: async () => { disposed = true; },
  };

  const wrapper = new AgentSessionWrapper(fakeProc, process.cwd());
  wrapper.start();

  await assert.rejects(
    wrapper.send({ type: "get_state" }),
    (err) => {
      assert.ok(err instanceof WebRpcError || err.name === "WebRpcError");
      assert.equal(err.code, "session_unresponsive");
      return true;
    },
  );

  assert.equal(disposed, true);
  assert.equal(wrapper.isAlive(), false);
});

test("prompt ack timeout recycles a child that accepts the frame but withholds its response", async (t) => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  const { AgentSessionWrapper, WebRpcError } = jiti("./rpc-manager.ts");
  const { RpcCommandTimeoutError } = jiti("./omp/rpc-process.ts");

  t.mock.timers.enable({ apis: ["setTimeout"] });
  let acceptedPrompt = null;
  let disposed = false;
  let removedFromRegistry = false;
  const fakeProc = {
    isAlive: true,
    onFrame: () => () => {},
    sendCommand: (command, timeoutMs) => {
      if (command.type !== "prompt") return Promise.resolve({});
      acceptedPrompt = command;
      // Model execution is not timed here. This promise represents only the
      // transport response to the accepted prompt frame.
      assert.equal(timeoutMs, 30000);
      return new Promise((_, reject) => {
        setTimeout(() => reject(new RpcCommandTimeoutError("prompt", timeoutMs)), timeoutMs);
      });
    },
    sendFrame: () => {},
    dispose: async () => { disposed = true; },
  };

  const wrapper = new AgentSessionWrapper(fakeProc, process.cwd());
  wrapper.onDestroy(() => { removedFromRegistry = true; });
  wrapper.start();

  const pending = wrapper.send({ type: "prompt", message: "Hello" });
  await Promise.resolve();
  assert.deepEqual(acceptedPrompt, { type: "prompt", message: "Hello" });
  t.mock.timers.tick(30000);

  await assert.rejects(
    pending,
    (err) => {
      assert.ok(err instanceof WebRpcError || err.name === "WebRpcError");
      assert.equal(err.code, "session_unresponsive");
      return true;
    },
  );

  assert.equal(disposed, true);
  assert.equal(removedFromRegistry, true);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(wrapper.isRunning(), false);
});

// ---------------------------------------------------------------------------
// Temporary session lifecycle seam (Slice 1): marker / alias / lifecycle lock.
// Executable tests — the module is loaded through jiti like the wrapper tests
// above.
// ---------------------------------------------------------------------------

async function loadRpcManager() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url)("./rpc-manager.ts");
}

const flushMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

test("temporary session markers remember, merge, and clear", async () => {
  const { rememberTemporarySession, getTemporarySession, clearTemporarySession, resolveCanonicalSessionId } = await loadRpcManager();

  const id = "temp-marker-1";
  rememberTemporarySession({ sessionId: id, cwd: "D:/tmp/ws-1", toolNames: ["read", "bash"], advisor: true });
  const marker = getTemporarySession(id);
  assert.ok(marker, "marker must be retrievable");
  assert.equal(marker.cwd, "D:/tmp/ws-1");
  assert.deepEqual(marker.toolNames, ["read", "bash"]);
  assert.equal(marker.advisor, true);
  assert.equal(typeof marker.expiresAt, "number");

  // A later remember merges startup config (recorded after set_model succeeds)
  // without dropping the spawn config.
  rememberTemporarySession({ sessionId: id, requestedModel: { provider: "p", modelId: "m" }, thinkingLevel: "high" });
  const merged = getTemporarySession(id);
  assert.equal(merged.cwd, "D:/tmp/ws-1");
  assert.deepEqual(merged.requestedModel, { provider: "p", modelId: "m" });
  assert.equal(merged.thinkingLevel, "high");

  clearTemporarySession(id);
  assert.equal(getTemporarySession(id), undefined);
  assert.equal(resolveCanonicalSessionId(id), id);
});

test("migrateTemporarySessionId moves the marker and aliases the old id", async () => {
  const { rememberTemporarySession, getTemporarySession, migrateTemporarySessionId, resolveCanonicalSessionId, clearTemporarySession } = await loadRpcManager();

  rememberTemporarySession({ sessionId: "temp-old-1", cwd: "D:/tmp/ws-2", toolNames: ["read"] });
  migrateTemporarySessionId("temp-old-1", "temp-new-1");

  assert.equal(getTemporarySession("temp-old-1"), undefined);
  const moved = getTemporarySession("temp-new-1");
  assert.ok(moved, "marker must move to the new id");
  assert.equal(moved.cwd, "D:/tmp/ws-2");
  assert.equal(resolveCanonicalSessionId("temp-old-1"), "temp-new-1");
  assert.equal(resolveCanonicalSessionId("temp-new-1"), "temp-new-1");

  // Clearing the canonical session also drops aliases pointing at it.
  clearTemporarySession("temp-new-1");
  assert.equal(resolveCanonicalSessionId("temp-old-1"), "temp-old-1");
});

test("temporary markers and aliases expire by TTL", async () => {
  const { rememberTemporarySession, getTemporarySession, migrateTemporarySessionId, resolveCanonicalSessionId, clearTemporarySession } = await loadRpcManager();

  rememberTemporarySession({ sessionId: "temp-ttl-1", cwd: "D:/tmp/ws-3" }, { ttlMs: -1 });
  assert.equal(getTemporarySession("temp-ttl-1"), undefined, "expired markers must not be returned");

  rememberTemporarySession({ sessionId: "temp-ttl-2", cwd: "D:/tmp/ws-3" });
  migrateTemporarySessionId("temp-ttl-2", "temp-ttl-3", { ttlMs: -1 });
  assert.equal(getTemporarySession("temp-ttl-3"), undefined);
  assert.equal(resolveCanonicalSessionId("temp-ttl-2"), "temp-ttl-2", "expired aliases must not canonicalize");
  clearTemporarySession("temp-ttl-2");
  clearTemporarySession("temp-ttl-3");
});

test("temporary marker table is bounded by an entry cap", async () => {
  const { rememberTemporarySession, getTemporarySession, clearTemporarySession, TEMPORARY_SESSION_MAX_ENTRIES } = await loadRpcManager();

  assert.ok(Number.isInteger(TEMPORARY_SESSION_MAX_ENTRIES) && TEMPORARY_SESSION_MAX_ENTRIES > 0, "an entry cap constant must be exported");

  const base = "temp-cap-";
  for (let i = 0; i < TEMPORARY_SESSION_MAX_ENTRIES + 5; i++) {
    rememberTemporarySession({ sessionId: `${base}${i}`, cwd: "D:/tmp/ws-4" });
  }
  assert.equal(getTemporarySession(`${base}0`), undefined, "oldest entries must be evicted when the cap is hit");
  assert.ok(getTemporarySession(`${base}${TEMPORARY_SESSION_MAX_ENTRIES + 4}`), "the newest entry must survive");
  for (let i = 0; i < TEMPORARY_SESSION_MAX_ENTRIES + 5; i++) clearTemporarySession(`${base}${i}`);
});

test("withSessionLifecycleLock serializes same-id operations", async () => {
  const { withSessionLifecycleLock, rememberTemporarySession, getTemporarySession, clearTemporarySession, migrateTemporarySessionId } = await loadRpcManager();

  // Same id: the queued operation must not start while the first holds the
  // lock, and must observe the first operation's cleanup (simulated DELETE).
  const order = [];
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = withSessionLifecycleLock("temp-lock-1", async () => {
    order.push("first-start");
    await gate;
    clearTemporarySession("temp-lock-1");
    order.push("first-end");
    return "first";
  });
  rememberTemporarySession({ sessionId: "temp-lock-1", cwd: "D:/tmp/ws-5" });
  const second = withSessionLifecycleLock("temp-lock-1", async () => {
    order.push("second");
    return getTemporarySession("temp-lock-1") === undefined;
  });

  await flushMacrotask();
  assert.ok(!order.includes("second"), "queued operation must not run while the lock is held");

  releaseFirst();
  assert.equal(await first, "first");
  assert.equal(await second, true, "a queued recovery must see the marker cleared and must not re-spawn");
  assert.deepEqual(order, ["first-start", "first-end", "second"]);

  // Distinct ids must not serialize each other.
  const parallel = [];
  const p1 = withSessionLifecycleLock("temp-lock-x", async () => { await flushMacrotask(); parallel.push("x"); });
  const p2 = withSessionLifecycleLock("temp-lock-y", async () => { parallel.push("y"); });
  await Promise.all([p1, p2]);
  assert.deepEqual(parallel, ["y", "x"]);

  // The lock is keyed by the canonical id: a request carrying the old alias
  // and one carrying the recovered id contend on the same lifecycle lock.
  rememberTemporarySession({ sessionId: "temp-lock-2", cwd: "D:/tmp/ws-5" });
  migrateTemporarySessionId("temp-lock-2", "temp-lock-3");
  let releaseAliasOp;
  const aliasGate = new Promise((resolve) => { releaseAliasOp = resolve; });
  const aliasOp = withSessionLifecycleLock("temp-lock-2", async () => { await aliasGate; parallel.length = 0; parallel.push("alias-op"); });
  const canonicalOp = withSessionLifecycleLock("temp-lock-3", async () => { parallel.push("canonical-op"); });
  await flushMacrotask();
  assert.ok(!parallel.includes("canonical-op"), "alias and canonical ids must share one lock");
  releaseAliasOp();
  await Promise.all([aliasOp, canonicalOp]);
  assert.deepEqual(parallel, ["alias-op", "canonical-op"]);
  clearTemporarySession("temp-lock-3");
});

test("temporary session metadata lives on globalThis, is bounded, and is registered only for file-less runtimes", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  // Memory-only state on globalThis (same pattern as __ompSessions) so it
  // survives Next.js hot reload without becoming persistent.
  assert.match(source, /__ompTemporarySessions/);
  assert.match(source, /__ompTemporaryAliases/);
  assert.match(source, /__ompLifecycleLocks/);
  assert.match(source, /TEMPORARY_SESSION_TTL_MS = IDLE_DESTROY_MS/);
  assert.match(source, /TEMPORARY_SESSION_MAX_ENTRIES/);
  // Only a ready runtime that still has no session file registers a marker.
  assert.match(source, /sessionFile === "" && created\.sessionFile === ""/);
  // The first confirmation that the real file exists stops the marker.
  assert.match(source, /clearTemporarySession\(this\._sessionId\)/);
});


test("lifecycle lock re-queues onto the migrated canonical id after an in-flight recovery", async () => {
  const { withSessionLifecycleLock, migrateTemporarySessionId, clearTemporarySession } = await loadRpcManager();

  let releaseRecovery;
  const gate = new Promise((resolve) => { releaseRecovery = resolve; });
  const order = [];

  // Recovery starts on the pre-migration id and migrates while holding the lock.
  const recovery = withSessionLifecycleLock("lc-a", async () => {
    order.push("recovery-start");
    await gate;
    migrateTemporarySessionId("lc-a", "lc-b");
    order.push("recovery-end");
    return "recovered";
  });

  // DELETE requested while recovery is in flight (alias not yet visible), and a
  // late recovery request addressed to the NEW id. Without re-queuing, the
  // queued delete (lc-a chain) and the late recovery (lc-b chain) would run in
  // parallel against the same canonical session.
  const del = withSessionLifecycleLock("lc-a", async () => {
    order.push("del-start");
    await flushMacrotask();
    order.push("del-end");
    return "deleted";
  });
  const lateRecovery = withSessionLifecycleLock("lc-b", async () => {
    order.push("late-start");
    await flushMacrotask();
    order.push("late-end");
    return "late";
  });

  await flushMacrotask();
  releaseRecovery();
  assert.deepEqual(await recovery, "recovered");
  assert.equal(await del, "deleted");
  assert.equal(await lateRecovery, "late");

  // The delete and the late recovery must be serialized on the canonical id —
  // neither may interleave with the other.
  const delEnd = order.indexOf("del-end");
  const lateStart = order.indexOf("late-start");
  const lateEnd = order.indexOf("late-end");
  const delStart = order.indexOf("del-start");
  assert.ok(
    delEnd < lateStart || lateEnd < delStart,
    `delete and late recovery interleaved: ${JSON.stringify(order)}`,
  );
  clearTemporarySession("lc-b");
});

test("two concurrent deletes run one terminal cleanup; the queued one observes the cleared state", async () => {
  const { withSessionLifecycleLock, rememberTemporarySession, getTemporarySession, clearTemporarySession } = await loadRpcManager();

  rememberTemporarySession({ sessionId: "lc-two", cwd: "D:/tmp/ws-del" });
  let terminalCleanups = 0;
  const deleteOp = () => withSessionLifecycleLock("lc-two", async () => {
    // Model destroyAndWait + unlink as one terminal cleanup, guarded by the
    // marker check the DELETE route performs under the lock.
    if (getTemporarySession("lc-two")) {
      terminalCleanups += 1;
      clearTemporarySession("lc-two");
      return "cleaned";
    }
    return "already-gone";
  });

  const [first, second] = await Promise.all([deleteOp(), deleteOp()]);
  assert.deepEqual([first, second].sort(), ["already-gone", "cleaned"]);
  assert.equal(terminalCleanups, 1, "only one terminal cleanup may run");
});

test("a delete addressed to an old alias id clears the canonical runtime", async () => {
  const { withSessionLifecycleLock, rememberTemporarySession, getTemporarySession, migrateTemporarySessionId, resolveCanonicalSessionId, clearTemporarySession } = await loadRpcManager();

  rememberTemporarySession({ sessionId: "lc-alias-old", cwd: "D:/tmp/ws-alias" });
  migrateTemporarySessionId("lc-alias-old", "lc-alias-new");

  // DELETE arrives with the pre-recovery id; the canonicalized marker must be
  // the one removed.
  await withSessionLifecycleLock("lc-alias-old", async () => {
    const canonical = resolveCanonicalSessionId("lc-alias-old");
    assert.equal(canonical, "lc-alias-new");
    clearTemporarySession(canonical);
  });

  assert.equal(getTemporarySession("lc-alias-new"), undefined, "canonical marker must be gone");
  assert.equal(getTemporarySession("lc-alias-old"), undefined);
});
