import { createMcpConnections, RUNNER_MCP } from "../mcp-connections.mjs";
import { createNativeTranscriptSink } from "../persistence/nativeTranscriptSink.mjs";
import { createAmpDriver } from "./amp.mjs";
import { createAntigravityDriver } from "./antigravity.mjs";
import { createClaudeCodeDriver } from "./claude-code.mjs";
import { createCodexDriver } from "./codex.mjs";
import { createGeminiDriver } from "./gemini.mjs";
import { createPiRpcDriver } from "./pi-rpc.mjs";
import { createRunnerDriverRegistry } from "./registry.mjs";
const DEFAULT_OYSTER_PORT = 8080;


// Mirrors the pi process launcher's UI URL policy. Kept local because
// pi-processes.mjs is a stable module: importing a new export from it would
// break hot reload until the whole server restarts.
function effectiveUiUrl(config) {
  for (const candidate of [config.OYSTER_URL, process.env.OYSTER_URL]) {
    if (candidate != null && String(candidate).trim() !== "") return String(candidate).trim();
  }
  return `http://127.0.0.1:${config.PORT ?? DEFAULT_OYSTER_PORT}`;
}

function nativePersistenceOptions(config) {
  return config.SQLITE_PATH ? {
    sqlitePath: config.SQLITE_PATH,
    transcriptSink: createNativeTranscriptSink({ sqlitePath: config.SQLITE_PATH, piBin: config.PI_BIN }),
  } : {};
}

function oysterEnv(config, token) {
  return { OYSTER_URL: effectiveUiUrl(config), ...(token ? { OYSTER_TOKEN: token } : {}) };
}

function optionalDriver(executable, factory) {
  return executable ? [factory()] : [];
}

function wrapMcpSettings(driver, mcpSettings) {
  if (!mcpSettings) return driver;
  return Object.freeze({
    ...driver,
    launch(options) {
      const servers = mcpSettings.snapshot();
      const connections = createMcpConnections(servers, options.cwd);
      Object.defineProperty(options.runner, RUNNER_MCP, { value: connections, configurable: true });
      try {
        const launched = driver.launch({ ...options, mcpServers: servers });
        launched.process.once("close", () => { void connections.close(); });
        return launched;
      } catch (error) { void connections.close(); throw error; }
    },
  });
}

function configuredDrivers({ config, piProcesses, openRouterRouting, token }) {
  const nativePersistence = nativePersistenceOptions(config);
  const env = oysterEnv(config, token);
  return [
    createPiRpcDriver({ config, processLauncher: piProcesses }),
    ...optionalDriver(config.CLAUDE_CODE_BIN, () => createClaudeCodeDriver({
      bin: config.CLAUDE_CODE_BIN, resolveRoute: () => openRouterRouting?.launch("claude-code"),
      extraArgs: config.CLAUDE_CODE_ARGS, permissionMode: config.CLAUDE_CODE_PERMISSION_MODE, sqlitePath: config.SQLITE_PATH, env,
    })),
    ...optionalDriver(config.CODEX_BIN, () => createCodexDriver({
      ...nativePersistence, bin: config.CODEX_BIN, resolveRoute: () => openRouterRouting?.launch("codex"),
      extraArgs: config.CODEX_ARGS, sandbox: config.CODEX_SANDBOX,
      bridgeOptions: { piAuthPath: `${config.PI_AGENT_DIR}/auth.json`, codexHome: config.CODEX_HOME }, env,
    })),
    ...optionalDriver(config.GEMINI_BIN, () => createGeminiDriver({
      ...nativePersistence, bin: config.GEMINI_BIN, extraArgs: config.GEMINI_ARGS, approvalMode: config.GEMINI_APPROVAL_MODE,
      bridgeOptions: { geminiOAuthPath: config.GEMINI_OAUTH_PATH }, env,
    })),
    ...optionalDriver(config.ANTIGRAVITY_BIN, () => createAntigravityDriver({
      ...nativePersistence, bin: config.ANTIGRAVITY_BIN, extraArgs: config.ANTIGRAVITY_ARGS, env,
    })),
    ...optionalDriver(config.AMP_BIN, () => createAmpDriver({
      ...nativePersistence, bin: config.AMP_BIN, extraArgs: config.AMP_ARGS,
      bridgeOptions: { ampSettingsPath: config.AMP_SETTINGS_PATH, ampMarkerPath: config.AMP_AUTH_MARKER_PATH }, env,
    })),
  ];
}

/** Build the harnesses enabled by validated server configuration. */
export function createConfiguredRunnerDrivers({ config, piProcesses, openRouterRouting, mcpSettings } = {}) {
  if (!config || typeof config !== "object") throw new TypeError("runner driver config is required");
  const token = config.TOKEN == null || config.TOKEN === "" ? null : String(config.TOKEN);
  return createRunnerDriverRegistry({
    defaultId: "pi",
    drivers: configuredDrivers({ config, piProcesses, openRouterRouting, token }).map((driver) => wrapMcpSettings(driver, mcpSettings)),
  });
}
