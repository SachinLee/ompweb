#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getUnsupportedNodeVersionMessage, isNodeVersionSupported } = require("./node-version");

if (!isNodeVersionSupported(process.versions.node)) {
  console.error(getUnsupportedNodeVersionMessage(process.versions.node));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseLaunchOptions } = require("./omp-web-options");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveConfiguredOmpConfig } = require("./omp-web-workflow-config");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isPortAvailable } = require("./port-availability");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { probeExistingOmpWeb } = require("./omp-web-instance");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assertProductionBuild } = require("./omp-web-build");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { wireChildProcessLifecycle } = require("./process-lifecycle");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getAccessibleAddresses, getBrowserUrl, formatAddressBanner, isLoopbackHost } = require("./network-addresses");


const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

let pkgVersion = "0.0.0";
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkg = require("../package.json");
  pkgVersion = pkg.version ?? "0.0.0";
} catch { /* ignore */ }

const commandName = "ompweb";
const launchOptions = parseLaunchOptions(process.argv.slice(2), process.env, commandName);
if (launchOptions.help || launchOptions.version) {
  process.exit(0);
}
const port = launchOptions.port;
const hostname = launchOptions.hostname;
const password = launchOptions.password;
const openBrowser = launchOptions.openBrowser;
// Propagate --password into the env for proxy.ts / lib/web-auth.ts and the spawned Next process.
if (password) process.env.OMP_WEB_PASSWORD = password;
const passwordEnabled = typeof password === "string" && password.length > 0;
try {
  assertProductionBuild(nextDir);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (!isLoopbackHost(hostname)) {
  if (!passwordEnabled) {
    console.error(`Refusing to listen on ${hostname} without OMP_WEB_PASSWORD (or --password). Set a strong password or bind to 127.0.0.1.`);
    process.exit(1);
  }
  console.warn(`Warning: ompweb is listening on ${hostname} over HTTP. Use HTTPS or a trusted VPN to protect the password and session cookie in transit.`);
}

const nextArgs = ["start", "-p", port];
nextArgs.push("-H", hostname);

// Always run next's JS entry with node directly — avoids .bin symlink issues
// and path-with-spaces problems on Windows when shell: true is used.
const url = getBrowserUrl(hostname, port);

function openBrowserUrl(targetUrl) {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const openCmd = isWindows ? "explorer.exe" : isMac ? "open" : "xdg-open";
  const opener = spawn(openCmd, [targetUrl], {
    stdio: "ignore",
    detached: true,
  });
  opener.on("error", (error) => {
    console.warn(`Could not open browser automatically: ${error.message}`);
  });
  opener.unref();
}

async function main() {
  if (!await isPortAvailable(port, hostname)) {
    if (await probeExistingOmpWeb(url)) {
      if (openBrowser) openBrowserUrl(url);
      console.log(`ompweb is already running at ${url}; reusing the existing workflow profile.`);
      return;
    }
    console.error(`Port ${port} on ${hostname} is already in use by a different program.`);
    console.error(`If ompweb is already running, open ${url}. Otherwise, stop the process using it or run: ompweb --port ${Number(port) + 1}`);
    process.exitCode = 1;
    return;
  }

  let ompConfig;
  try {
    ompConfig = resolveConfiguredOmpConfig({
      explicitPath: launchOptions.ompConfig,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  if (ompConfig) process.env.OMP_WEB_OMP_CONFIG = ompConfig;

  const child = spawn(process.execPath, [nextBin, ...nextArgs], {
    cwd: pkgDir,
    stdio: ["inherit", "pipe", "inherit"],
    env: {
      ...process.env,
      OMP_WEB_PACKAGE_DIR: pkgDir,
      OMP_WEB_LAUNCHER_PID: String(process.pid),
      OMP_WEB_PORT: port,
      OMP_WEB_HOSTNAME: hostname,
    },
  });
  wireChildProcessLifecycle(child);

  let bannerPrinted = false;
  let browserOpened = false;
  let readyBuffer = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    readyBuffer += text;
    if (readyBuffer.length > 500) readyBuffer = readyBuffer.slice(-500);
    if (readyBuffer.includes("Ready")) {
      if (!bannerPrinted) {
        bannerPrinted = true;
        const { entries, hint } = getAccessibleAddresses({ hostname, port });
        const banner = formatAddressBanner({
          version: pkgVersion,
          entries,
          hint,
          passwordEnabled,
          isTTY: process.stdout.isTTY,
        });
        process.stdout.write(banner);
      }
      if (openBrowser && !browserOpened) {
        browserOpened = true;
        openBrowserUrl(url);
      }
    }
  });
}

main().catch((error) => {
  console.error(`Could not check whether ${url} is available: ${error.message}`);
  process.exit(1);
});
