import { spawn } from "node:child_process";

/** Single policy boundary for every coding-agent subprocess. */
export function createPiProcessLauncher({ config, spawnImpl = spawn } = {}) {
  if (!config?.PI_BIN) throw new Error("PI_BIN is required for the pi process launcher");
  const persistentStore = config.PERSISTENT_STORE ?? "jsonl";
  const uiUrl = String(config.OYSTER_URL ?? process.env.OYSTER_URL ?? `http://127.0.0.1:${config.PORT ?? 8080}`).trim();

  function launch(args, options = {}) {
    return spawnImpl(config.PI_BIN, args, {
      ...options,
      env: {
        ...process.env,
        ...(options.env ?? {}),
        PERSISTENT_STORE: persistentStore,
        OYSTER_URL: uiUrl,
        ...(config.TOKEN ? { OYSTER_TOKEN: config.TOKEN } : {}),
      },
    });
  }

  function ephemeral(args, options = {}) {
    const safeArgs = args.includes("--no-session") ? args : ["--no-session", ...args];
    return launch(safeArgs, options);
  }

  return Object.freeze({
    bin: config.PI_BIN,
    persistentStore,
    launch,
    ephemeral,
  });
}
