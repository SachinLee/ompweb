import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { parseLaunchOptions } = require("./omp-web-options.js");

test("launcher accepts an explicit omp config path", () => {
  const parsed = parseLaunchOptions(["--omp-config", "D:\\workflow.yml"], {});
  assert.equal(parsed.ompConfig, "D:\\workflow.yml");
});

test("launcher CLI config overrides the environment", () => {
  const parsed = parseLaunchOptions(
    ["--omp-config", "cli.yml"],
    { OMP_WEB_OMP_CONFIG: "environment.yml" },
  );
  assert.equal(parsed.ompConfig, "cli.yml");
});
