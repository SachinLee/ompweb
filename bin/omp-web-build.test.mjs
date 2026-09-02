import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { assertProductionBuild } = await import("./omp-web-build.js");

test("rejects a dev-only .next directory with an actionable build message", () => {
  const root = mkdtempSync(join(tmpdir(), "ompweb-build-"));
  mkdirSync(join(root, "dev"));
  assert.throws(
    () => assertProductionBuild(root),
    /Production build not found.*npm run build/s,
  );
});

test("accepts a Next production build marker", () => {
  const root = mkdtempSync(join(tmpdir(), "ompweb-build-"));
  writeFileSync(join(root, "BUILD_ID"), "build-id\n");
  assert.doesNotThrow(() => assertProductionBuild(root));
});
