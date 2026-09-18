import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpSettings } from "./mcp-settings.mjs";
import { spawn } from "node:child_process";

import { requireNonBlankString as nonEmptyString } from "./validation.mjs";

function normalizeArgs(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new TypeError("pi process arguments must be an array of strings");
  }
  return [...args];
}

function normalizeOptions(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("pi process options must be an object");
  }
  if (options.env !== undefined && (options.env === null || typeof options.env !== "object" || Array.isArray(options.env))) {
    throw new TypeError("pi process environment must be an object");
  }
  return options;
}

function effectiveUiUrl(config) {
  for (const candidate of [config.OYSTER_URL, process.env.OYSTER_URL]) {
    if (candidate != null && String(candidate).trim() !== "") return String(candidate).trim();
  }
  return `http://127.0.0.1:${config.PORT ?? 8080}`;
}

/** Single policy boundary for every coding-agent subprocess. */
export function createPiProcessLauncher({ config, spawnImpl = spawn } = {}) {
  const bin = nonEmptyString(config?.PI_BIN, "PI_BIN");
  if (typeof spawnImpl !== "function") throw new TypeError("spawnImpl must be a function");

  // Snapshot policy values so a later config mutation cannot silently change the
  // executable or credentials used by an already-created launcher.
  const persistentStore = nonEmptyString(config.PERSISTENT_STORE ?? "jsonl", "PERSISTENT_STORE");
  const uiUrl = effectiveUiUrl(config);
  const token = config.TOKEN == null || config.TOKEN === "" ? null : String(config.TOKEN);

  function launch(args, options = {}) {
    const normalizedArgs = normalizeArgs(args);
    const normalizedOptions = normalizeOptions(options);
    const env = { ...process.env, ...(normalizedOptions.env ?? {}) };
    if (token === null) delete env.OYSTER_TOKEN;
    else env.OYSTER_TOKEN = token;
    env.PERSISTENT_STORE = persistentStore;
    env.OYSTER_URL = uiUrl;
    // Include ephemeral pi agents as well as interactive runners.
    const servers = config.PI_AGENT_DIR ? createMcpSettings(join(config.PI_AGENT_DIR, "mcp-servers.json")).snapshot() : [];
    delete env.OYSTER_MCP_SERVERS;
    delete env.OYSTER_MCP_MODULE;
    if (servers.length) {
      env.OYSTER_MCP_SERVERS = JSON.stringify(servers);
      env.OYSTER_MCP_MODULE = fileURLToPath(new URL("./mcp-connections.mjs", import.meta.url));
      normalizedArgs.push("--extension", fileURLToPath(new URL("../extensions/mcp-servers.ts", import.meta.url)));
    }

    return spawnImpl(bin, normalizedArgs, { ...normalizedOptions, env });
  }

  function ephemeral(args, options = {}) {
    const safeArgs = normalizeArgs(args);
    if (!safeArgs.includes("--no-session")) safeArgs.unshift("--no-session");
    return launch(safeArgs, options);
  }

  return Object.freeze({
    bin,
    persistentStore,
    launch,
    ephemeral,
  });
}
