import { createNativeTranscriptSink } from "../persistence/nativeTranscriptSink.mjs";
import { createAmpDriver } from "./amp.mjs";
import { createAntigravityDriver } from "./antigravity.mjs";
import { createClaudeCodeDriver } from "./claude-code.mjs";
import { createCodexDriver } from "./codex.mjs";
import { createGeminiDriver } from "./gemini.mjs";
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
  const nativePersistence = config.SQLITE_PATH ? {
    sqlitePath: config.SQLITE_PATH,
    transcriptSink: createNativeTranscriptSink({ sqlitePath: config.SQLITE_PATH, piBin: config.PI_BIN }),
  } : {};
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
      ...(config.CODEX_BIN ? [createCodexDriver({
        ...nativePersistence,
        bin: config.CODEX_BIN,
        extraArgs: config.CODEX_ARGS,
        sandbox: config.CODEX_SANDBOX,
        bridgeOptions: { piAuthPath: `${config.PI_AGENT_DIR}/auth.json`, codexHome: config.CODEX_HOME },
        env: { OYSTER_URL: effectiveUiUrl(config), ...(token ? { OYSTER_TOKEN: token } : {}) },
      })] : []),
      ...(config.GEMINI_BIN ? [createGeminiDriver({
        ...nativePersistence,
        bin: config.GEMINI_BIN,
        extraArgs: config.GEMINI_ARGS,
        approvalMode: config.GEMINI_APPROVAL_MODE,
        bridgeOptions: { geminiOAuthPath: config.GEMINI_OAUTH_PATH },
        env: { OYSTER_URL: effectiveUiUrl(config), ...(token ? { OYSTER_TOKEN: token } : {}) },
      })] : []),
      ...(config.ANTIGRAVITY_BIN ? [createAntigravityDriver({
        ...nativePersistence,
        bin: config.ANTIGRAVITY_BIN,
        extraArgs: config.ANTIGRAVITY_ARGS,
        env: { OYSTER_URL: effectiveUiUrl(config), ...(token ? { OYSTER_TOKEN: token } : {}) },
      })] : []),
      ...(config.AMP_BIN ? [createAmpDriver({
        ...nativePersistence,
        bin: config.AMP_BIN,
        extraArgs: config.AMP_ARGS,
        bridgeOptions: { ampSettingsPath: config.AMP_SETTINGS_PATH, ampMarkerPath: config.AMP_AUTH_MARKER_PATH },
        env: { OYSTER_URL: effectiveUiUrl(config), ...(token ? { OYSTER_TOKEN: token } : {}) },
      })] : []),
    ],
  });
}
