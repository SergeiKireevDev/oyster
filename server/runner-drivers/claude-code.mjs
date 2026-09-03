import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { validateRunnerDriver } from "./contract.mjs";

function nonEmpty(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function timestamp(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function textContent(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (block?.type === "text") return [{ type: "text", text: String(block.text ?? "") }];
    if (block?.type === "thinking") return [{ type: "thinking", thinking: String(block.thinking ?? ""), ...(block.signature ? { thinkingSignature: block.signature } : {}) }];
    if (block?.type === "tool_use") return [{ type: "toolCall", id: String(block.id ?? randomUUID()), name: String(block.name ?? "tool"), arguments: block.input && typeof block.input === "object" ? block.input : {} }];
    if (block?.type === "image" && block.source?.type === "base64") return [{ type: "image", data: String(block.source.data ?? ""), mimeType: String(block.source.media_type ?? "application/octet-stream") }];
    return [];
  });
}

function usageFrom(message, totalCost = 0) {
  const usage = message?.usage ?? {};
  const input = finite(usage.input_tokens);
  const output = finite(usage.output_tokens);
  const cacheRead = finite(usage.cache_read_input_tokens);
  const cacheWrite = finite(usage.cache_creation_input_tokens);
  return {
    input, output, cacheRead, cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: finite(totalCost) },
  };
}

function stopReason(reason) {
  return ({ end_turn: "stop", stop_sequence: "stop", max_tokens: "length", tool_use: "toolUse" })[reason] ?? "stop";
}

function assistantMessage(record) {
  const message = record.message ?? {};
  return {
    role: "assistant",
    content: textContent(message.content),
    api: "anthropic-messages",
    provider: "anthropic",
    model: String(message.model ?? record.model ?? "claude"),
    ...(message.id ? { responseId: message.id } : {}),
    usage: usageFrom(message),
    stopReason: record.error ? "error" : stopReason(message.stop_reason),
    ...(record.error ? { errorMessage: String(message.content?.[0]?.text ?? record.error) } : {}),
    timestamp: timestamp(record.timestamp),
  };
}

function toolResults(record, runtime) {
  const blocks = Array.isArray(record.message?.content) ? record.message.content : [];
  return blocks.filter((block) => block?.type === "tool_result").flatMap((block) => {
    const toolCallId = String(block.tool_use_id ?? "");
    if (!toolCallId) return [];
    const content = textContent(block.content).filter((item) => item.type === "text" || item.type === "image");
    return [{
      role: "toolResult",
      toolCallId,
      toolName: runtime.toolNames.get(toolCallId) ?? "tool",
      content: content.length ? content : [{ type: "text", text: "" }],
      isError: block.is_error === true,
      timestamp: timestamp(record.timestamp),
    }];
  });
}

function userMessage(record) {
  const content = textContent(record.message?.content).filter((item) => item.type === "text" || item.type === "image");
  if (!content.length) return null;
  return { role: "user", content, timestamp: timestamp(record.timestamp) };
}

function response(id, command, data, success = true, error = undefined) {
  return { type: "response", id, command, success, ...(success ? { data } : { error: error ?? `${command} is unsupported` }) };
}

function ensureRuntime(runner) {
  return runner.driverRuntime ??= {
    sessionId: runner.sessionId ?? null,
    model: null,
    sessionName: runner.sessionName ?? null,
    messages: [],
    streaming: false,
    initialized: false,
    stateRequests: [],
    toolNames: new Map(),
  };
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
} = {}) {
  const executable = nonEmpty(bin, "Claude Code executable");
  if (!Array.isArray(extraArgs) || extraArgs.some((arg) => typeof arg !== "string")) throw new TypeError("Claude Code arguments must be strings");
  if (typeof spawnImpl !== "function") throw new TypeError("Claude Code spawn implementation must be a function");
  return Object.freeze(validateRunnerDriver({
    id: "claude-code",
    label: "Claude Code",

    isSessionCompatible(reference) {
      return !reference || reference.backend === "claude-code";
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
        const results = toolResults(record, runtime);
        for (const message of results) {
          runtime.messages.push(message);
          events.push({ type: "tool_execution_end", toolCallId: message.toolCallId, result: message, isError: message.isError });
          events.push({ type: "message_end", message });
        }
        const user = userMessage(record);
        if (user && !results.length) {
          runtime.messages.push(user);
          events.push({ type: "message_start", message: user });
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
        emit(response(command.id, "get_available_models", { models: runtime.model ? [{ provider: "anthropic", id: runtime.model }] : [] }));
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
      return { backend: "claude-code", id, storagePath: null };
    },
  }));
}
