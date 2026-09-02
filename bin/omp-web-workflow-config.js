/* eslint-disable @typescript-eslint/no-require-imports */

"use strict";

const fs = require("fs");
const path = require("path");

function nonEmpty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function existingFile(candidate) {
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/** Resolve and validate the explicit config inherited by live OMP children. */
function resolveConfiguredOmpConfig({ explicitPath, env = process.env, cwd = process.cwd() } = {}) {
  const configured = nonEmpty(explicitPath) ?? nonEmpty(env.OMP_WEB_OMP_CONFIG);
  if (!configured) return null;

  const candidate = path.resolve(cwd, configured);
  if (!existingFile(candidate)) throw new Error(`OMP config file was not found: ${candidate}`);
  return candidate;
}

module.exports = { resolveConfiguredOmpConfig };
