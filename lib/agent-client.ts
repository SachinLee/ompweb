// Client-side helper for POST /api/agent/[id].
//
// Every /api/agent/[id] route returns one of:
//   { success: true, data: <result>, sessionId?: <runtime id> }
//   { error: string }              (non-2xx)
//
// Call sites previously repeated the same 5-line fetch block 13× in
// hooks/useAgentSession.ts. This helper collapses that down to one line.

import { formatApiError } from "@/lib/i18n/api-error";

// Sessions whose per-chat advisor toggle is on: their lazily spawned omp
// process must start with --advisor. Keyed by session id because the spawn
// decision happens inside the route, which only sees id + query string.
const advisorSpawnSessions = new Set<string>();

export function setSessionAdvisorSpawn(sessionId: string, enabled: boolean) {
  if (enabled) advisorSpawnSessions.add(sessionId);
  else advisorSpawnSessions.delete(sessionId);
}

export interface SendAgentCommandOptions {
  /** Called when the response envelope reports a runtime id different from
   * the requested one — temporary-session recovery re-keys the wrapper under
   * a new omp id. Only fires when the caller explicitly passes the callback;
   * saved/live sessions (same id or no sessionId field) never trigger it. */
  onSessionIdChange?: (previousId: string, nextId: string) => void;
}

export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
  options?: SendAgentCommandOptions,
): Promise<T> {
  const query = advisorSpawnSessions.has(sessionId) ? "?advisor=1" : "";
  const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
    code?: string;
    sessionId?: unknown;
  };
  if (!res.ok || body.error) {
    // Routes attach a stable `code` for well-known failures; these messages are
    // surfaced to the user as notices, so localize before throwing.
    throw new Error(
      body.error || body.code ? formatApiError(body) : `HTTP ${res.status}`,
    );
  }
  // A recovery response re-keys the runtime: notify the caller BEFORE it
  // issues further requests. Same id (live/saved paths), missing, or
  // non-string sessionId is a no-op — only temporary recovery migrates.
  if (
    options?.onSessionIdChange &&
    typeof body.sessionId === "string" &&
    body.sessionId &&
    body.sessionId !== sessionId
  ) {
    options.onSessionIdChange(sessionId, body.sessionId);
  }
  return body.data as T;
}
