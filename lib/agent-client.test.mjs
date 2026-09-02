import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

// sendAgentCommand is the single POST boundary for /api/agent/[id]. Slice 2
// adds an optional onSessionIdChange send option: temporary-session recovery
// re-keys the runtime under a new omp id and the response envelope reports it.
// Executable tests via jiti (same pattern as rpc-manager.test.mjs).

async function loadAgentClient() {
  const { createJiti } = await import("jiti");
  // jiti does not read tsconfig paths here; map the "@/" alias to the repo root.
  return createJiti(import.meta.url, {
    alias: { "@": fileURLToPath(new URL("../", import.meta.url)) },
  })("./agent-client.ts");
}

/** Install a fake globalThis.fetch that answers every call with `body`. */
function withFakeFetch(body, { status = 200 } = {}, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return Promise.resolve()
    .then(run)
    .finally(() => { globalThis.fetch = original; })
    // Give the caller the recorded requests alongside the run result.
    .then((result) => ({ result, calls }));
}

test("a response sessionId different from the requested id fires the migration callback and still returns data", async () => {
  const { sendAgentCommand } = await loadAgentClient();

  const changes = [];
  const { result } = await withFakeFetch(
    { success: true, sessionId: "new-id", data: { ok: 42 } },
    {},
    () => sendAgentCommand("old-id", { type: "prompt", message: "hi" }, {
      onSessionIdChange: (previousId, nextId) => changes.push([previousId, nextId]),
    }),
  );

  assert.deepEqual(changes, [["old-id", "new-id"]], "exactly one old->new notification");
  assert.deepEqual(result, { ok: 42 }, "the return value stays body.data");
});

test("same-id, absent, or non-string response sessionId never triggers the callback", async () => {
  const { sendAgentCommand } = await loadAgentClient();

  for (const body of [
    { success: true, sessionId: "same-id", data: null },
    { success: true, data: null },
    { success: true, sessionId: 12345, data: null },
    { success: true, sessionId: "", data: null },
  ]) {
    let fired = false;
    const { result } = await withFakeFetch(body, {}, () => sendAgentCommand("same-id", { type: "get_state" }, {
      onSessionIdChange: () => { fired = true; },
    }));
    assert.equal(fired, false, `no migration for ${JSON.stringify(body)}`);
    assert.equal(result, null);
  }
});

test("without options the behavior is unchanged: data returned, no callback machinery", async () => {
  const { sendAgentCommand } = await loadAgentClient();

  const { result } = await withFakeFetch(
    { success: true, sessionId: "other-id", data: { value: 7 } },
    {},
    () => sendAgentCommand("same-id", { type: "get_state" }),
  );
  assert.deepEqual(result, { value: 7 });
});

test("error responses still throw with the localized message before any migration", async () => {
  const { sendAgentCommand } = await loadAgentClient();

  let fired = false;
  await assert.rejects(
    withFakeFetch(
      { error: "Session not found", code: "session_not_found" },
      { status: 404 },
      () => sendAgentCommand("gone-id", { type: "prompt" }, {
        onSessionIdChange: () => { fired = true; },
      }),
    ).then(({ result }) => result),
    /Session not found/,
  );
  assert.equal(fired, false);
});

test("the requested id still rides the URL path and the command body is forwarded verbatim", async () => {
  const { sendAgentCommand } = await loadAgentClient();

  const { calls } = await withFakeFetch(
    { success: true, sessionId: "new-id", data: null },
    {},
    () => sendAgentCommand("old/id 1", { type: "prompt", message: "hello" }, {
      onSessionIdChange: () => {},
    }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `/api/agent/${encodeURIComponent("old/id 1")}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { type: "prompt", message: "hello" });
});
