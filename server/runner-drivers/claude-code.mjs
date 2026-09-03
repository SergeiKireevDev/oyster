import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { validateRunnerDriver } from "./contract.mjs";
import { assistantMessage, claudeRecordMessages } from "./claude-transcript.mjs";

function nonEmpty(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function response(id, command, data, success = true, error = undefined) {
  return { type: "response", id, command, success, ...(success ? { data } : { error: error ?? `${command} is unsupported` }) };
}

function ensureRuntime(runner) {
  const runtime = runner.driverRuntime ??= {
    sessionId: runner.sessionId ?? null,
    model: null,
    sessionName: runner.sessionName ?? null,
    messages: [],
    streaming: false,
    initialized: false,
    stateRequests: [],
    toolNames: new Map(),
    controlRequests: new Map(),
  };
  runtime.controlRequests ??= new Map();
  return runtime;
}

function stateFor(runner, runtime) {
  return {
    sessionId: runtime.sessionId ?? runner.sessionId ?? null,
    sessionName: runtime.sessionName ?? runner.sessionName ?? null,
    sessionFile: null,
    model: runtime.model ? { provider: "anthropic", id: runtime.model } : null,
    thinkingLevel: "off",
    messageCount: runtime.messages.length,
    pendingMessageCount: 0,
    isStreaming: runtime.streaming,
    isCompacting: false,
  };
}

/** Translate Claude Code's headless stream-json protocol into Oyster's canonical runner protocol. */
export function createClaudeCodeDriver({
  bin = "claude",
  extraArgs = [],
  spawnImpl = spawn,
  permissionMode = "default",
  sqlitePath = null,
  models = ["default", "sonnet", "opus", "haiku", "fable"],
} = {}) {
  const executable = nonEmpty(bin, "Claude Code executable");
  if (!Array.isArray(extraArgs) || extraArgs.some((arg) => typeof arg !== "string")) throw new TypeError("Claude Code arguments must be strings");
  if (!Array.isArray(models) || models.some((model) => typeof model !== "string" || !model.trim())) throw new TypeError("Claude Code models must be non-empty strings");
  const availableModelIds = [...new Set(models.map((model) => model.trim()))];
  if (typeof spawnImpl !== "function") throw new TypeError("Claude Code spawn implementation must be a function");
  return Object.freeze(validateRunnerDriver({
    id: "claude-code",
    label: "Claude Code",

    isSessionCompatible(reference) {
      return !reference || reference.backend === "claude-code" || (Boolean(sqlitePath) && reference.backend === "sqlite");
    },

    launch({ runner, cwd, systemPrompt }) {
      const sessionId = runner.sessionRef?.id ?? runner.sessionId ?? randomUUID();
      const runtime = ensureRuntime(runner);
      runtime.sessionId = sessionId;
      const args = [
        "--print", "--verbose",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--permission-mode", permissionMode,
        ...(runner.sessionRef ? ["--resume", sessionId] : ["--session-id", sessionId]),
        ...(systemPrompt ? ["--append-system-prompt", systemPrompt] : []),
        ...extraArgs,
      ];
      const process = spawnImpl(executable, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...globalThis.process.env } });
      return { process, description: `${executable} ${args.join(" ")}` };
    },

    decodeLine(runner, line) {
      let record;
      try { record = JSON.parse(String(line)); } catch { return []; }
      if (!record || typeof record !== "object") return [];
      const runtime = ensureRuntime(runner);
      const events = [];

      if (record.type === "control_response") {
        const control = record.response ?? {};
        const pending = runtime.controlRequests.get(control.request_id);
        if (!pending) return [];
        runtime.controlRequests.delete(control.request_id);
        if (control.subtype === "success") {
          runtime.model = pending.model;
          for (const id of runtime.stateRequests.splice(0)) events.push(response(id, "get_state", stateFor(runner, runtime)));
          events.push(response(pending.id, "set_model", {}));
        } else {
          events.push(response(pending.id, "set_model", null, false, String(control.error ?? "Claude Code rejected the model")));
        }
        return events;
      }

      if (record.type === "system" && record.subtype === "init") {
        runtime.initialized = true;
        runtime.sessionId = record.session_id ?? runtime.sessionId;
        runtime.model = record.model ?? runtime.model;
        for (const id of runtime.stateRequests.splice(0)) events.push(response(id, "get_state", stateFor(runner, runtime)));
        return events;
      }

      if (record.session_id) runtime.sessionId = record.session_id;
      if (record.type === "assistant") {
        const message = assistantMessage(record);
        runtime.model = message.model;
        runtime.streaming = true;
        runtime.messages.push(message);
        for (const block of message.content) if (block.type === "toolCall") runtime.toolNames.set(block.id, block.name);
        events.push({ type: "message_start", message }, { type: "message_end", message });
      } else if (record.type === "user") {
        const messages = claudeRecordMessages(record, runtime.toolNames);
        for (const message of messages) {
          runtime.messages.push(message);
          if (message.role === "toolResult") {
            events.push({ type: "tool_execution_end", toolCallId: message.toolCallId, result: message, isError: message.isError });
            events.push({ type: "message_end", message });
          } else {
            events.push({ type: "message_start", message });
          }
        }
      } else if (record.type === "result") {
        runtime.streaming = false;
        if (record.is_error) events.push({ type: "pi_error", error: String(record.result ?? record.terminal_reason ?? "Claude Code failed") });
        events.push({ type: "agent_end", willRetry: false }, { type: "agent_settled" });
      }
      return events;
    },

    sendCommand(runner, child, command) {
      const runtime = ensureRuntime(runner);
      const emit = (event) => queueMicrotask(() => runner.driverEmit?.(event));
      if (command.type === "get_state") {
        if (!runtime.initialized) runtime.stateRequests.push(command.id);
        else emit(response(command.id, "get_state", stateFor(runner, runtime)));
        return true;
      }
      if (command.type === "get_messages") {
        emit(response(command.id, "get_messages", { messages: [...runtime.messages] }));
        return true;
      }
      if (command.type === "get_available_models") {
        const ids = [...new Set([...availableModelIds, runtime.model].filter(Boolean))];
        emit(response(command.id, "get_available_models", { models: ids.map((id) => ({ provider: "anthropic", id })) }));
        return true;
      }
      if (command.type === "set_model") {
        if (!child?.stdin?.writable) return false;
        if (command.provider !== "anthropic" || typeof command.modelId !== "string" || !command.modelId.trim()) {
          emit(response(command.id, "set_model", null, false, "Claude Code requires an anthropic model"));
          return true;
        }
        const requestId = `oyster-model-${command.id}`;
        runtime.controlRequests.set(requestId, { id: command.id, model: command.modelId.trim() });
        child.stdin.write(`${JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "set_model", model: command.modelId.trim() } })}\n`);
        return true;
      }
      if (command.type === "prompt") {
        if (!child?.stdin?.writable) return false;
        const message = { role: "user", content: String(command.message ?? "") };
        const canonical = { role: "user", content: message.content, timestamp: Date.now() };
        if (!runtime.sessionName) runtime.sessionName = message.content.trim().split("\n")[0].slice(0, 80) || "Claude Code session";
        runtime.messages.push(canonical);
        runtime.streaming = true;
        emit({ type: "message_start", message: canonical });
        emit({ type: "agent_start" });
        child.stdin.write(`${JSON.stringify({ type: "user", message, session_id: runtime.sessionId, parent_tool_use_id: null })}\n`);
        emit(response(command.id, "prompt", {}));
        return true;
      }
      if (command.type === "abort") {
        child?.kill?.("SIGINT");
        runtime.streaming = false;
        emit(response(command.id, "abort", {}));
        return true;
      }
      if (command.type === "set_session_name") {
        runtime.sessionName = typeof command.name === "string" ? command.name : runtime.sessionName;
        emit(response(command.id, "set_session_name", {}));
        return true;
      }
      emit(response(command.id, command.type, null, false, `${command.type} is not supported by Claude Code`));
      return true;
    },

    stateCommand(id) { return { id, type: "get_state" }; },

    startup({ requestId }) {
      return { commands: [{ id: requestId, type: "get_state" }], resumeResponseId: null };
    },

    sessionReference(state, currentReference) {
      const id = state?.sessionId ?? currentReference?.id;
      if (!id) return null;
      return sqlitePath
        ? { backend: "sqlite", id, storagePath: sqlitePath }
        : { backend: "claude-code", id, storagePath: null };
    },
  }));
}
