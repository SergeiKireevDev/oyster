import { createClaudeCodeDriver } from "./claude-code.mjs";
import { createPiRpcDriver } from "./pi-rpc.mjs";
import { createRunnerDriverRegistry } from "./registry.mjs";

// Mirrors the pi process launcher's UI URL policy. Kept local because
// pi-processes.mjs is a stable module: importing a new export from it would
// break hot reload until the whole server restarts.
function effectiveUiUrl(config) {
  for (const candidate of [config.OYSTER_URL, process.env.OYSTER_URL]) {
    if (candidate != null && String(candidate).trim() !== "") return String(candidate).trim();
  }
  return `http://127.0.0.1:${config.PORT ?? 8080}`;
}

/** Build the harnesses enabled by validated server configuration. */
export function createConfiguredRunnerDrivers({ config, piProcesses } = {}) {
  if (!config || typeof config !== "object") throw new TypeError("runner driver config is required");
  const pi = createPiRpcDriver({ config, processLauncher: piProcesses });
  const token = config.TOKEN == null || config.TOKEN === "" ? null : String(config.TOKEN);
  return createRunnerDriverRegistry({
    defaultId: "pi",
    drivers: [
      pi,
      ...(config.CLAUDE_CODE_BIN ? [createClaudeCodeDriver({
        bin: config.CLAUDE_CODE_BIN,
        extraArgs: config.CLAUDE_CODE_ARGS,
        permissionMode: config.CLAUDE_CODE_PERMISSION_MODE,
        sqlitePath: config.SQLITE_PATH,
        env: { OYSTER_URL: effectiveUiUrl(config), ...(token ? { OYSTER_TOKEN: token } : {}) },
      })] : []),
    ],
  });
}
