"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}


function printHelp(commandName = "ompweb") {
  console.log(`Usage: ${commandName} [options]

Options:
  -p, --port <port>        Server port (default 30177, env PORT)
  -H, --hostname <host>    Bind hostname (default 127.0.0.1, env OMP_WEB_HOSTNAME)
      --password <pass>    Password for the web sign-in screen (env OMP_WEB_PASSWORD)
      --omp-config <path>  OMP config passed to every live child (env OMP_WEB_OMP_CONFIG)
      --no-open            Do not open the browser automatically
  -h, --help               Show this help
      --version            Show version

Password:
  ${commandName} --password "a-long-random-password"
  # env-variable forms (POSIX, PowerShell, CMD handled uniformly)
  OMP_WEB_PASSWORD="secret" ${commandName}
  $env:OMP_WEB_PASSWORD="secret"; ${commandName}   # PowerShell
  set OMP_WEB_PASSWORD=secret&& ${commandName}     # CMD

Security: use HTTPS via a trusted reverse proxy or VPN when binding to a
non-loopback hostname, so the password and session cookie stay private.`);
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env, commandName = "ompweb") {
  const { values: cliArgs } = parseArgs({
    args,
    options: {
      port:        { type: "string", short: "p" },
      hostname:    { type: "string", short: "H" },
      password:    { type: "string" },
      "omp-config": { type: "string" },
      help:        { type: "boolean", short: "h" },
      version:     { type: "boolean" },
      "no-open":   { type: "boolean" },
    },
    strict: false,
  });

  // CLI values win over env so Windows users have first-class options without
  // shell-specific inline environment syntax.
  const password = cliArgs.password ?? env.OMP_WEB_PASSWORD;
  const ompConfig = cliArgs["omp-config"] ?? env.OMP_WEB_OMP_CONFIG;
  if (cliArgs.version) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require("../package.json");
      console.log(pkg.version ?? "0.0.0");
    } catch { console.log("0.0.0"); }
    return {
      port: cliArgs.port ?? env.PORT ?? "30177",
      hostname: cliArgs.hostname ?? env.OMP_WEB_HOSTNAME ?? "127.0.0.1",
      password,
      ompConfig,
      openBrowser: !cliArgs["no-open"] && !isEnabled(env.OMP_WEB_NO_OPEN),
      version: true,
    };
  }
  // Expose help flag without exiting here — caller (bin/omp-web.js) decides
  // whether to exit, keeping parseLaunchOptions testable. Print here so
  // --help works even when the caller is a test.
  if (cliArgs.help) {
    printHelp(commandName);
    return {
      port: cliArgs.port ?? env.PORT ?? "30177",
      hostname: cliArgs.hostname ?? env.OMP_WEB_HOSTNAME ?? "127.0.0.1",
      password,
      ompConfig,
      openBrowser: !cliArgs["no-open"] && !isEnabled(env.OMP_WEB_NO_OPEN),
      help: true,
    };
  }
  return {
    port: cliArgs.port ?? env.PORT ?? "30177",
    hostname: cliArgs.hostname ?? env.OMP_WEB_HOSTNAME ?? "127.0.0.1",
    password,
    ompConfig,
    openBrowser: !cliArgs["no-open"] && !isEnabled(env.OMP_WEB_NO_OPEN),
  };
}


module.exports = { parseLaunchOptions };
