import { createClaudeCodeDriver } from "./claude-code.mjs";
import { createPiRpcDriver } from "./pi-rpc.mjs";
import { createRunnerDriverRegistry } from "./registry.mjs";

/** Build the harnesses enabled by validated server configuration. */
export function createConfiguredRunnerDrivers({ config, piProcesses } = {}) {
  if (!config || typeof config !== "object") throw new TypeError("runner driver config is required");
  const pi = createPiRpcDriver({ config, processLauncher: piProcesses });
  return createRunnerDriverRegistry({
    defaultId: "pi",
    drivers: [
      pi,
      ...(config.CLAUDE_CODE_BIN ? [createClaudeCodeDriver({
        bin: config.CLAUDE_CODE_BIN,
        extraArgs: config.CLAUDE_CODE_ARGS,
        permissionMode: config.CLAUDE_CODE_PERMISSION_MODE,
        sqlitePath: config.SQLITE_PATH,
      })] : []),
    ],
  });
}
