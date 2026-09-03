import { validateRunnerDriver } from "./contract.mjs";

function requireMethod(value, name) {
  if (typeof value?.[name] !== "function") throw new TypeError(`pi RPC driver requires processLauncher.${name}()`);
}

function parsedObject(line) {
  try {
    const value = JSON.parse(String(line).trim());
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Adapter between Oyster's canonical runner commands/events and pi's NDJSON RPC mode.
 * A different coding-agent driver can implement the same interface without changing
 * the runner lifecycle, persistence, watchdog, or HTTP routes.
 */
export function createPiRpcDriver({ config, processLauncher } = {}) {
  if (!config || typeof config !== "object") throw new TypeError("pi RPC driver config is required");
  requireMethod(processLauncher, "launch");

  return Object.freeze(validateRunnerDriver({
    id: "pi",
    label: "pi",
    sessionBackend: config.PERSISTENT_STORE,

    isSessionCompatible(reference) {
      return !reference || reference.backend === config.PERSISTENT_STORE;
    },

    launch({ runner, initialArgs = [], cwd, systemPrompt }) {
      const sessionArgs = runner.sessionRef?.backend === "sqlite"
        ? ["--session", runner.sessionRef.id]
        : [];
      const args = [
        "--mode", "rpc",
        ...sessionArgs,
        ...initialArgs,
        ...config.PI_EXTRA_ARGS,
        "--append-system-prompt", systemPrompt,
      ];
      const process = processLauncher.launch(args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
      return {
        process,
        description: `${processLauncher.bin ?? config.PI_BIN} ${args.join(" ")}`,
      };
    },

    decodeLine(_runner, line) {
      const event = parsedObject(line);
      return event ? [event] : [];
    },

    sendCommand(_runner, process, command) {
      if (!process?.stdin?.writable) return false;
      process.stdin.write(`${JSON.stringify(command)}\n`);
      return true;
    },

    stateCommand(id) {
      return { id, type: "get_state" };
    },

    startup({ runner, requestId }) {
      if (runner.sessionRef?.backend === "jsonl") {
        return {
          commands: [{ id: requestId, type: "switch_session", sessionPath: runner.sessionRef.storagePath }],
          resumeResponseId: requestId,
        };
      }
      return { commands: [{ id: requestId, type: "get_state" }], resumeResponseId: null };
    },

    sessionReference(state, currentReference) {
      if (state?.sessionId && state.sessionFile) {
        return { backend: "jsonl", id: state.sessionId, storagePath: state.sessionFile };
      }
      if (state?.sessionId && config.PERSISTENT_STORE === "sqlite") {
        return { backend: "sqlite", id: state.sessionId, storagePath: config.SQLITE_PATH };
      }
      return currentReference ?? null;
    },
  }));
}
