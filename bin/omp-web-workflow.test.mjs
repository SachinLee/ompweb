import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { resolveConfiguredOmpConfig } = require("./omp-web-workflow-config.js");

function makeFixture() {
  return mkdtempSync(join(tmpdir(), "ompweb-workflow-"));
}

test("explicit omp config is validated and normal ompweb stays unconfigured", () => {
  const root = makeFixture();
  const explicit = join(root, "explicit.yml");
  writeFileSync(explicit, "skills: {}\n");

  assert.equal(resolveConfiguredOmpConfig({ explicitPath: explicit, cwd: root }), explicit);
  assert.equal(resolveConfiguredOmpConfig({ cwd: root }), null);
  assert.throws(
    () => resolveConfiguredOmpConfig({ explicitPath: join(root, "missing.yml"), cwd: root }),
    /OMP config file was not found/,
  );
});

test("ompweb does not claim the workflow launcher's ompw command", async () => {
  const packageJson = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.bin.ompweb, "bin/omp-web.js");
  assert.equal(packageJson.bin.ompw, undefined);
});
