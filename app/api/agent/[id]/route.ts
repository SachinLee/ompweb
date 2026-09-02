import { NextResponse } from "next/server";
import { statSync } from "fs";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { apiErrorResponse } from "@/lib/api-utils";
import {
  startRpcSession,
  getRpcSession,
  resolveSpawnCwdResult,
  WebRpcError,
  resolveCanonicalSessionId,
  getTemporarySession,
  migrateTemporarySessionId,
  withSessionLifecycleLock,
} from "@/lib/rpc-manager";
import { RpcCommandError } from "@/lib/omp/rpc-process";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { MAX_AGENT_COMMAND_REQUEST_BYTES } from "@/lib/image-attachments";

/** omp-web's own failures carry a stable code the client can localize; omp's
 * errors stay opaque English text. */
function commandErrorResponse(error: unknown) {
  if (error instanceof RequestBodyTooLargeError) {
    return NextResponse.json({ error: "Agent command is too large", code: "request_too_large" }, { status: 413 });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "Invalid JSON request body", code: "invalid_json" }, { status: 400 });
  }
  if (error instanceof WebRpcError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  }
  if (error instanceof RpcCommandError) {
    return NextResponse.json({ error: error.message, code: error.code ?? "rpc_command_failed" }, { status: 400 });
  }
  return apiErrorResponse(error);
}

const SESSION_NOT_FOUND = { error: "Session not found", code: "session_not_found" } as const;

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await parseJsonWithinLimit<{ type?: unknown; [key: string]: unknown }>(req, MAX_AGENT_COMMAND_REQUEST_BYTES);
    if (typeof body.type !== "string" || !body.type.trim()) {
      return NextResponse.json({ error: "command type is required", code: "command_type_required" }, { status: 400 });
    }

    // The per-chat advisor choice rides on the query string (never the RPC
    // body, which is forwarded to omp verbatim) and only matters when this
    // request spawns or replaces the session's omp process.
    const advisor = new URL(req.url).searchParams.get("advisor") === "1";

    // A request may still carry a pre-recovery id; resolve it through the
    // alias table so late requests land on the same lifecycle object as the
    // recovered runtime.
    const canonicalId = resolveCanonicalSessionId(id);

    // Fast path: already-running session. --advisor is a spawn-time flag with
    // no runtime RPC, so a toggle that now differs from the live child's spawn
    // flag must replace an idle child to take effect; busy children keep
    // running and pick the flag up at the next natural respawn.
    const existing = getRpcSession(canonicalId);
    if (existing?.isAlive()) {
      if (existing.advisorSpawned === advisor || existing.isRunning()) {
        const result = await existing.send(body);
        return NextResponse.json({ success: true, sessionId: existing.sessionId || canonicalId, data: result });
      }
      await existing.destroyAndWait();
    }

    // Saved path: the JSONL file is the authority for an existing session.
    const filePath = await resolveSessionPath(canonicalId);
    if (filePath) {
      // The SPAWN runs under the lifecycle lock with in-lock re-checks so a
      // concurrent DELETE can never be overtaken: a fresh --resume child
      // spawned during the delete's scan would recreate the file after the
      // unlink. Canonicalization happens at execution time for the same
      // reason as the recovery path below.
      const saved = await withSessionLifecycleLock(id, async () => {
        const lockCanonicalId = resolveCanonicalSessionId(id);
        // In-lock live re-check: another request may have spawned meanwhile.
        const live = getRpcSession(lockCanonicalId);
        if (live?.isAlive()) return { session: live, realSessionId: live.sessionId || lockCanonicalId };
        const lockFilePath = await resolveSessionPath(lockCanonicalId);
        if (!lockFilePath) return null; // the file vanished — the delete won
        const header = readSessionHeader(lockFilePath);
        const { cwd } = resolveSpawnCwdResult(header?.cwd);
        const started = await startRpcSession(lockCanonicalId, lockFilePath, cwd, undefined, advisor, header?.cwd);
        return { session: started.session, realSessionId: started.realSessionId };
      });
      if (saved) {
        const result = await saved.session.send(body);
        return NextResponse.json({ success: true, sessionId: saved.realSessionId, data: result });
      }
      // Fall through: the file vanished while this request was queued, so
      // the marker check below decides between recovery and 404.
    }

    // Temporary recovery path: no live wrapper and no file, but an unexpired
    // marker from /api/agent/new means omp-web owns this session and can
    // rebuild a runtime for it. RPC/network errors must NOT degrade to 404 —
    // session_not_found is reserved for ids with no file, no live wrapper and
    // no transient metadata at all.
    const marker = getTemporarySession(canonicalId);
    if (!marker?.cwd) {
      return NextResponse.json(SESSION_NOT_FOUND, { status: 404 });
    }

    // The recorded cwd is omp-web's own startup choice; it must still be a
    // real directory before it drives a spawn.
    let markerCwdIsDirectory = false;
    try {
      markerCwdIsDirectory = statSync(marker.cwd).isDirectory();
    } catch {
      markerCwdIsDirectory = false;
    }
    if (!markerCwdIsDirectory) {
      throw new WebRpcError(
        `This session's working directory no longer exists: ${marker.cwd}`,
        "temporary_cwd_missing",
      );
    }

    // Canonicalization happens at execution time: a prior holder (an
    // in-flight recovery or delete) may migrate the id while this request
    // waits, and the queued body must land on the migrated runtime.
    const recovered = await withSessionLifecycleLock(id, async () => {
      const canonicalId = resolveCanonicalSessionId(id);
      // Re-check under the lifecycle lock: a concurrent request may already
      // have recovered the runtime, or the session file may have just landed
      // (then the saved path applies instead of a file-less spawn).
      const live = getRpcSession(canonicalId);
      if (live?.isAlive()) {
        return { session: live, realSessionId: live.sessionId || canonicalId };
      }

      const lockFilePath = await resolveSessionPath(canonicalId);
      if (lockFilePath) {
        const header = readSessionHeader(lockFilePath);
        const { cwd } = resolveSpawnCwdResult(header?.cwd);
        const started = await startRpcSession(canonicalId, lockFilePath, cwd, undefined, advisor, header?.cwd);
        return { session: started.session, realSessionId: started.realSessionId };
      }

      // Re-check the marker under the lifecycle lock: a concurrent DELETE
      // clears it before destroying, so a queued recovery must NOT spawn a
      // replacement after the delete completed.
      const currentMarker = getTemporarySession(canonicalId);
      if (!currentMarker?.cwd) return null;

      // Re-spawn the file-less runtime from the marker's recorded startup
      // config — never a cwd or toolset from the request body.
      const started = await startRpcSession(canonicalId, "", marker.cwd, marker.toolNames, advisor);
      try {
        if (marker.requestedModel) {
          await started.session.send({ type: "set_model", provider: marker.requestedModel.provider, modelId: marker.requestedModel.modelId });
        }
        if (marker.thinkingLevel) {
          await started.session.send({ type: "set_thinking_level", level: marker.thinkingLevel });
        }
      } catch (error) {
        // A half-configured replacement must not linger as a second
        // half-alive runtime: destroy it and surface the real error.
        await started.session.destroyAndWait();
        throw error;
      }
      if (started.realSessionId && started.realSessionId !== canonicalId) {
        migrateTemporarySessionId(canonicalId, started.realSessionId);
      }
      return { session: started.session, realSessionId: started.realSessionId };
    });
    if (!recovered) {
      // The delete won the race: the transient record is gone.
      return NextResponse.json(SESSION_NOT_FOUND, { status: 404 });
    }

    const result = await recovered.session.send(body);

    return NextResponse.json({ success: true, sessionId: recovered.realSessionId, recovered: true, data: result });
  } catch (error) {
    return commandErrorResponse(error);
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = getRpcSession(resolveCanonicalSessionId(id));
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }
    try {
      const state = await session.send({ type: "get_state" });
      return NextResponse.json({ running: true, state });
    } catch (error) {
      if (error instanceof WebRpcError && error.code === "session_unresponsive") {
        return NextResponse.json({ running: false, recovered: true });
      }
      throw error;
    }
  } catch (error) {
    return commandErrorResponse(error);
  }
}
