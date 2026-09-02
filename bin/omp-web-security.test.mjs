import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("launcher refuses unauthenticated non-loopback binds", async () => {
  const source = await readFile(new URL("./omp-web.js", import.meta.url), "utf8");
  assert.match(source, /Refusing to listen on/);
  assert.match(source, /!passwordEnabled/);
});

test("health endpoint is reachable by the singleton launcher without a login cookie", async () => {
  const source = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(source, /pathname === "\/healthz"/);
});

test("launcher probes an occupied port before reporting a conflict", async () => {
  const source = await readFile(new URL("./omp-web.js", import.meta.url), "utf8");
  assert.match(source, /probeExistingOmpWeb\(url\)/);
  assert.match(source, /if \(await probeExistingOmpWeb\(url\)\)/);
});
