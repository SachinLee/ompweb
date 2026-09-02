import assert from "node:assert/strict";
import test from "node:test";

const { probeExistingOmpWeb } = await import("./omp-web-instance.js");

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test("recognizes the ompweb health endpoint", async () => {
  const result = await probeExistingOmpWeb("http://127.0.0.1:30177", {
    fetchImpl: async (url) => {
      assert.equal(url, "http://127.0.0.1:30177/healthz");
      return response({ service: "ompweb", ok: true, version: "0.3.5" });
    },
  });
  assert.equal(result, true);
});

test("does not mistake another HTTP service for ompweb", async () => {
  assert.equal(
    await probeExistingOmpWeb("http://127.0.0.1:30177", {
      fetchImpl: async () => response({ service: "other", ok: true }),
    }),
    false,
  );
  assert.equal(
    await probeExistingOmpWeb("http://127.0.0.1:30177", {
      fetchImpl: async () => response({ service: "ompweb", ok: true }, 503),
    }),
    false,
  );
});

test("treats probe failures as an unavailable ompweb instance", async () => {
  assert.equal(
    await probeExistingOmpWeb("http://127.0.0.1:30177", {
      fetchImpl: async () => { throw new Error("connection refused"); },
    }),
    false,
  );
});

test("formats IPv6 loopback URLs for health probes", async () => {
  const result = await probeExistingOmpWeb("http://[::1]:30177", {
    fetchImpl: async (url) => {
      assert.equal(url, "http://[::1]:30177/healthz");
      return response({ service: "ompweb", ok: true });
    },
  });
  assert.equal(result, true);
});
