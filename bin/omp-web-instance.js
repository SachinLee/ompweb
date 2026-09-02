"use strict";

const HEALTH_PATH = "/healthz";
const PROBE_TIMEOUT_MS = 1_000;

function healthUrl(baseUrl) {
  return new URL(HEALTH_PATH, baseUrl).toString();
}

/** Return true only when the occupied endpoint proves it is ompweb. */
async function probeExistingOmpWeb(baseUrl, { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(healthUrl(baseUrl), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.service === "ompweb" && body?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { HEALTH_PATH, probeExistingOmpWeb };
