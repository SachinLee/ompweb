/* eslint-disable @typescript-eslint/no-require-imports */

"use strict";

const fs = require("fs");
const path = require("path");

function assertProductionBuild(nextDir) {
  const marker = path.join(nextDir, "BUILD_ID");
  if (!fs.existsSync(marker)) {
    throw new Error(
      `Production build not found in ${nextDir}. Run "npm run build" before starting ompweb.`,
    );
  }
}

module.exports = { assertProductionBuild };
