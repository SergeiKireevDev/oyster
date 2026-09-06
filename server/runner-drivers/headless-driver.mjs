import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { validateRunnerDriver } from "./contract.mjs";

const BRIDGE = fileURLToPath(new URL("./headless-bridge.mjs", import.meta.url));
const DEFAULT_UI_URL = "http://127.0.0.1:8080";

function nonEmpty(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function timestamp(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function response(id, command, data, success = true, error = undefined) {
  return { type: "response", id, command, success, ...(success ? { data } : { error: error ?? `${command} is unsupported` }) };
}

export function oysterMcpUrl({ runnerId = null, sessionId, workdir, uiUrl = DEFAULT_UI_URL }) {
  const params = new URLSearchParams({ session: nonEmpty(sessionId, "session id"), workdir: nonEmpty(workdir, "workdir") });
  if (runnerId) params.set("runner", runnerId);
  return `${nonEmpty(uiUrl, "Oyster UI URL").replace(/\/+$/, "")}/mcp?${params}`;
}

function runtimeFor(runner, defaults) {
  const runtime = runner.driverRuntime ??= {
    sessionId: runner.sessionRef?.id ?? runner.sessionId ?? defaults.sessionId ?? null,
    sessionName: runner.sessionName ?? null,
    model: defaults.model ?? null,
    messages: [],
    streaming: false,
    initialized: Boolean(runner.sessionRef),
    systemPrompt: defaults.systemPrompt ?? "",
    currentMessage: null,
    toolNames: new Map(),
  };
  return runtime;
}

function usage({ input = 0, output = 0, cacheRead = 0, cacheWrite = 0 } = {}) {
  input = finite(input); output = finite(output); cacheRead = finite(cacheRead); cacheWrite = finite(cacheWrite);
  return { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function stateFor(runner, runtime, provider) {
  return {
    sessionId: runtime.sessionId ?? runner.sessionId ?? null,
    sessionName: runtime.sessionName ?? runner.sessionName ?? null,
    sessionFile: null,
    model: runtime.model ? { provider, id: runtime.model } : null,
    thinkingLevel: "off",
    messageCount: runtime.messages.length,
    pendingMessageCount: 0,
    isStreaming: runtime.streaming,
    isCompacting: false,
  };
}

function toolResultMessage(runtime, id, name, text, isError, at) {
  const message = {
    role: "toolResult", toolCallId: id, toolName: name,
    content: [{ type: "text", text: resultText(text) }], isError: Boolean(isError), timestamp: timestamp(at),
  };
  runtime.messages.push(message);
  return message;
}

function isAuthenticationFailure(value) {
  const text = typeof value === "string" ? value : (() => { try { return JSON.stringify(value); } catch { return ""; } })();
  return /(?:oauth|access token|refresh token|authentication|unauthorized).*(?:expired|invalid|failed|required|401)|(?:expired|invalid|failed).*(?:oauth|access token|refresh token)|\b401\b/i.test(text);
}

function resultText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => typeof item?.text === "string" ? item.text : JSON.stringify(item)).join("\n");
  if (value == null) return "";
  try { return JSON.stringify(value); } catch { return String(value); }
}

function assistant(runtime, { provider, api, model, content, at, messageUsage = usage(), stopReason = "stop" }) {
  const message = {
    role: "assistant", content, api, provider, model: model ?? runtime.model ?? provider,
    usage: messageUsage, stopReason, timestamp: timestamp(at),
  };
  runtime.messages.push(message);
  return message;
}

function finishStreamingMessage(runtime, events, stopReason = "stop") {
  if (!runtime.currentMessage) return;
  runtime.currentMessage.stopReason = stopReason;
  events.push({ type: "message_end", message: runtime.currentMessage });
  runtime.currentMessage = null;
}

function startTool(runtime, events, { id, name, args, provider, api, model, at }) {
  finishStreamingMessage(runtime, events);
  if (!runtime.toolNames.has(id)) {
    runtime.toolNames.set(id, name);
    const message = assistant(runtime, {
      provider, api, model, at, stopReason: "toolUse",
      content: [{ type: "toolCall", id, name, arguments: args && typeof args === "object" ? args : {} }],
    });
    events.push({ type: "message_start", message }, { type: "message_end", message });
  }
  events.push({ type: "tool_execution_start", toolCallId: id, toolName: name, args: args && typeof args === "object" ? args : {} });
}

function endTool(runtime, events, { id, name, text, isError, at }) {
  const resolvedName = name ?? runtime.toolNames.get(id) ?? "tool";
  const message = toolResultMessage(runtime, id, resolvedName, text, isError, at);
  events.push({ type: "tool_execution_end", toolCallId: id, toolName: resolvedName, result: message, isError: Boolean(isError) });
  events.push({ type: "message_end", message });
}

function decodeCodex(runtime, record) {
  const events = [];
  if (record.type === "thread.started" && record.thread_id) {
    runtime.sessionId = record.thread_id;
    runtime.initialized = true;
  } else if (record.type === "item.started") {
    const item = record.item ?? {};
    if (item.type === "command_execution") startTool(runtime, events, { id: item.id, name: "shell", args: { command: item.command }, provider: "openai", api: "codex", model: runtime.model });
    else if (item.type === "mcp_tool_call") startTool(runtime, events, { id: item.id, name: item.tool ?? "mcp", args: item.arguments, provider: "openai", api: "codex", model: runtime.model });
    else if (item.type === "web_search") startTool(runtime, events, { id: item.id, name: "web_search", args: { query: item.query }, provider: "openai", api: "codex", model: runtime.model });
  } else if (record.type === "item.completed") {
    const item = record.item ?? {};
    if (item.type === "agent_message" || item.type === "reasoning") {
      const content = item.type === "reasoning" ? [{ type: "thinking", thinking: String(item.text ?? "") }] : [{ type: "text", text: String(item.text ?? "") }];
      const message = assistant(runtime, { provider: "openai", api: "codex", model: runtime.model, content });
      events.push({ type: "message_start", message }, { type: "message_end", message });
    } else if (["command_execution", "mcp_tool_call", "web_search"].includes(item.type)) {
      const name = item.type === "command_execution" ? "shell" : item.type === "web_search" ? "web_search" : item.tool ?? "mcp";
      if (!runtime.toolNames.has(item.id)) startTool(runtime, events, { id: item.id, name, args: item.arguments ?? (item.command ? { command: item.command } : { query: item.query }), provider: "openai", api: "codex", model: runtime.model });
      const failed = ["failed", "declined"].includes(item.status) || Boolean(item.error);
      endTool(runtime, events, { id: item.id, name, isError: failed, text: item.aggregated_output ?? item.error?.message ?? item.result?.content ?? item.result ?? item.status });
    } else if (item.type === "file_change") {
      const id = item.id ?? `file-change-${runtime.messages.length}`;
      const args = { changes: item.changes ?? [] };
      startTool(runtime, events, { id, name: "file_change", args, provider: "openai", api: "codex", model: runtime.model });
      endTool(runtime, events, { id, name: "file_change", isError: item.status === "failed", text: item.status ?? "completed" });
    } else if (item.type === "error") {
      events.push({ type: "pi_error", error: String(item.message ?? "Codex reported an error") });
    }
  } else if (record.type === "turn.completed") {
    runtime.streaming = false;
    events.push({ type: "agent_end", willRetry: false }, { type: "agent_settled" });
  } else if (record.type === "turn.failed") {
    runtime.streaming = false;
    events.push({ type: "pi_error", error: String(record.error?.message ?? "Codex failed") });
    events.push({ type: "agent_end", willRetry: false }, { type: "agent_settled" });
  } else if (record.type === "error") {
    // Codex also uses top-level error records for retry notices. Keep the turn
    // active until turn.failed, turn.completed, or the bridge reports exit.
    events.push({ type: "pi_error", error: String(record.message ?? "Codex reported an error") });
  }
  return events;
}

function decodeGemini(runtime, record) {
  const events = [];
  if (record.type === "init") {
    runtime.sessionId = record.session_id ?? runtime.sessionId;
    runtime.model = record.model ?? runtime.model;
    runtime.initialized = true;
  } else if (record.type === "message" && record.role === "assistant") {
    const delta = String(record.content ?? "");
    if (!runtime.currentMessage) {
      runtime.currentMessage = assistant(runtime, { provider: "google", api: "gemini-cli", model: runtime.model, at: record.timestamp, content: [{ type: "text", text: "" }] });
      events.push({ type: "message_start", message: runtime.currentMessage });
    }
    runtime.currentMessage.content[0].text += delta;
    events.push({ type: "message_update", message: runtime.currentMessage, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta, partial: runtime.currentMessage } });
  } else if (record.type === "tool_use") {
    startTool(runtime, events, { id: String(record.tool_id ?? "tool"), name: String(record.tool_name ?? "tool"), args: record.parameters, provider: "google", api: "gemini-cli", model: runtime.model, at: record.timestamp });
  } else if (record.type === "tool_result") {
    endTool(runtime, events, { id: String(record.tool_id ?? "tool"), text: record.output ?? record.error?.message, isError: record.status === "error", at: record.timestamp });
  } else if (record.type === "error") {
    events.push({ type: "pi_error", error: String(record.message ?? "Gemini CLI reported an error") });
  } else if (record.type === "result") {
    finishStreamingMessage(runtime, events, record.status === "error" ? "error" : "stop");
    runtime.streaming = false;
    if (record.status === "error") events.push({ type: "pi_error", error: String(record.error?.message ?? "Gemini CLI failed") });
    events.push({ type: "agent_end", willRetry: false }, { type: "agent_settled" });
  }
  return events;
}

function ampAssistant(runtime, record) {
  const source = record.message ?? {};
  const content = (Array.isArray(source.content) ? source.content : []).flatMap((block) => {
    if (block?.type === "text") return [{ type: "text", text: String(block.text ?? "") }];
    if (block?.type === "thinking") return [{ type: "thinking", thinking: String(block.thinking ?? "") }];
    if (block?.type === "tool_use") return [{ type: "toolCall", id: String(block.id ?? "tool"), name: String(block.name ?? "tool"), arguments: block.input && typeof block.input === "object" ? block.input : {} }];
    return [];
  });
  return assistant(runtime, {
    provider: "amp", api: "amp", model: runtime.model ?? "amp", content, at: record.timestamp,
    messageUsage: usage({ input: source.usage?.input_tokens, output: source.usage?.output_tokens, cacheRead: source.usage?.cache_read_input_tokens, cacheWrite: source.usage?.cache_creation_input_tokens }),
    stopReason: source.stop_reason === "tool_use" ? "toolUse" : source.stop_reason === "max_tokens" ? "length" : "stop",
  });
}

function decodeAmp(runtime, record) {
  const events = [];
  if (record.type === "system" && record.subtype === "init") {
    runtime.sessionId = record.session_id ?? runtime.sessionId;
    runtime.initialized = true;
  } else if (record.type === "assistant") {
    const message = ampAssistant(runtime, record);
    events.push({ type: "message_start", message }, { type: "message_end", message });
    for (const block of message.content) if (block.type === "toolCall") {
      runtime.toolNames.set(block.id, block.name);
      events.push({ type: "tool_execution_start", toolCallId: block.id, toolName: block.name, args: block.arguments });
    }
    if (record.message?.stop_reason && record.message.stop_reason !== "tool_use" && record.message.stop_reason !== "pause_turn") {
      runtime.streaming = false;
      events.push({ type: "agent_end", willRetry: false }, { type: "agent_settled" });
    }
  } else if (record.type === "user") {
    const blocks = Array.isArray(record.message?.content) ? record.message.content : [];
    for (const block of blocks) if (block?.type === "tool_result" && block.tool_use_id) {
      endTool(runtime, events, { id: String(block.tool_use_id), text: block.content, isError: block.is_error, at: record.timestamp });
    }
  } else if (record.type === "system" && record.error) {
    events.push({ type: "pi_error", error: String(record.error) });
  } else if (record.type === "result") {
    if (record.is_error) events.push({ type: "pi_error", error: String(record.error ?? record.result ?? "Amp failed") });
    if (runtime.streaming) {
      runtime.streaming = false;
      events.push({ type: "agent_end", willRetry: false }, { type: "agent_settled" });
    }
  }
  return events;
}

export function createHeadlessDriver({
  id, label, bin, kind = id, provider, extraArgs = [], spawnImpl = spawn, env = {}, uiUrl = env?.OYSTER_URL ?? DEFAULT_UI_URL,
  sandbox = "workspace-write", approvalMode = "auto_edit", generateSessionId = false, defaultModel = null,
  bridgeOptions = {},
} = {}) {
  id = nonEmpty(id, "headless driver id");
  const executable = nonEmpty(bin, `${label ?? id} executable`);
  provider = nonEmpty(provider, `${label ?? id} provider`);
  if (!["codex", "gemini", "amp"].includes(kind)) throw new TypeError(`unsupported headless bridge kind: ${kind}`);
  if (!Array.isArray(extraArgs) || extraArgs.some((arg) => typeof arg !== "string")) throw new TypeError(`${label ?? id} arguments must be strings`);
  if (typeof spawnImpl !== "function") throw new TypeError(`${label ?? id} spawn implementation must be a function`);
  if (!env || typeof env !== "object" || Array.isArray(env)) throw new TypeError(`${label ?? id} environment must be an object`);
  if (!bridgeOptions || typeof bridgeOptions !== "object" || Array.isArray(bridgeOptions)) throw new TypeError(`${label ?? id} bridge options must be an object`);

  return Object.freeze(validateRunnerDriver({
    id, label: label ?? id,
    isSessionCompatible(reference) { return !reference || reference.backend === id; },

    launch({ runner, cwd, systemPrompt }) {
      const provisionalId = runner.sessionRef?.id ?? runner.sessionId ?? (generateSessionId ? randomUUID() : runner.id ?? randomUUID());
      const runtime = runtimeFor(runner, { sessionId: generateSessionId ? provisionalId : runner.sessionRef?.id ?? null, model: defaultModel, systemPrompt });
      const mcpUrl = oysterMcpUrl({ runnerId: runner.id ?? null, sessionId: provisionalId, workdir: cwd, uiUrl });
      const bridgeConfig = { kind, bin: executable, cwd, extraArgs, systemPrompt, mcpUrl, sandbox, approvalMode, ...bridgeOptions };
      const environment = { ...globalThis.process.env, OYSTER_TOKEN: "", ...env, OYSTER_HEADLESS_BRIDGE_CONFIG: JSON.stringify(bridgeConfig) };
      const childProcess = spawnImpl(globalThis.process.execPath, [BRIDGE], { cwd, stdio: ["pipe", "pipe", "pipe"], env: environment });
      return { process: childProcess, description: `${label ?? id} bridge (${executable})` };
    },

    decodeLine(runner, line) {
      let record;
      try { record = JSON.parse(String(line)); } catch { return []; }
      if (!record || typeof record !== "object" || Array.isArray(record)) return [];
      const runtime = runtimeFor(runner, { model: defaultModel });
      if (record.type === "oyster.bridge.pong") return [];
      if (record.type === "oyster.bridge.turn_start") {
        runtime.streaming = true;
        return [{ type: "agent_start" }];
      }
      if (record.type === "oyster.bridge.turn_exit") {
        if (!runtime.streaming) return [];
        runtime.streaming = false;
        const error = record.error || (record.code !== 0 ? String(record.stderr || `${label ?? id} exited with code ${record.code}`).trim() : null);
        return [
          ...(error ? [{ type: "pi_error", error }] : []),
          ...(error && kind !== "amp" && isAuthenticationFailure(error) ? [{ type: "harness_auth_failed", reason: `${kind}_oauth` }] : []),
          { type: "agent_end", willRetry: false }, { type: "agent_settled" },
        ];
      }
      const previousSessionId = runtime.sessionId;
      const previousModel = runtime.model;
      const wasInitialized = runtime.initialized;
      const events = kind === "codex" ? decodeCodex(runtime, record)
        : kind === "gemini" ? decodeGemini(runtime, record)
          : decodeAmp(runtime, record);
      // Persist a native session identity as soon as the CLI announces it,
      // rather than waiting for a possibly long-running first turn to settle.
      if ((!wasInitialized && runtime.initialized) || previousSessionId !== runtime.sessionId || previousModel !== runtime.model) {
        events.push(response(`_driver-${kind}-state`, "get_state", stateFor(runner, runtime, provider)));
      }
      const explicitError = record.type === "error" || record.type === "turn.failed" || record.is_error === true
        ? record.error ?? record.message ?? record.result : null;
      if (kind !== "amp" && explicitError && isAuthenticationFailure(explicitError)) {
        events.push({ type: "harness_auth_failed", reason: `${kind}_oauth` });
      }
      return events;
    },

    sendCommand(runner, child, command) {
      const runtime = runtimeFor(runner, { model: defaultModel });
      const emit = (event) => queueMicrotask(() => runner.driverEmit?.(event));
      if (command.type === "get_state") { emit(response(command.id, "get_state", stateFor(runner, runtime, provider))); return true; }
      if (command.type === "get_messages") { emit(response(command.id, "get_messages", { messages: [...runtime.messages] })); return true; }
      if (command.type === "health_probe") {
        if (!child?.stdin?.writable) return false;
        child.stdin.write(`${JSON.stringify({ type: "health", id: command.id })}\n`);
        return true;
      }
      if (command.type === "get_available_models") {
        const models = runtime.model ? [{ provider, id: runtime.model }] : [];
        emit(response(command.id, "get_available_models", { models }));
        return true;
      }
      if (command.type === "set_model") {
        if (kind === "amp") { emit(response(command.id, "set_model", null, false, "Amp selects its model automatically")); return true; }
        if (command.provider !== provider || typeof command.modelId !== "string" || !command.modelId.trim()) {
          emit(response(command.id, "set_model", null, false, `${label ?? id} requires a ${provider} model`)); return true;
        }
        runtime.model = command.modelId.trim();
        emit(response(command.id, "set_model", {}));
        return true;
      }
      if (command.type === "prompt") {
        if (!child?.stdin?.writable) return false;
        const text = String(command.message ?? "");
        const message = { role: "user", content: text, timestamp: Date.now() };
        if (!runtime.sessionName) runtime.sessionName = text.trim().split("\n")[0].slice(0, 80) || `${label ?? id} session`;
        runtime.messages.push(message);
        const steer = runtime.streaming;
        runtime.streaming = true;
        emit({ type: "message_start", message });
        child.stdin.write(`${JSON.stringify({ type: "run", prompt: text, sessionId: runtime.sessionId, resume: runtime.initialized, steer, model: runtime.model })}\n`);
        emit(response(command.id, "prompt", {}));
        return true;
      }
      if (command.type === "abort") {
        if (!child?.stdin?.writable) return false;
        child.stdin.write(`${JSON.stringify({ type: "abort" })}\n`);
        if (runtime.streaming) {
          runtime.streaming = false;
          emit({ type: "agent_end", willRetry: false }); emit({ type: "agent_settled" });
        }
        emit(response(command.id, "abort", {}));
        return true;
      }
      if (command.type === "set_session_name") { runtime.sessionName = typeof command.name === "string" ? command.name : runtime.sessionName; emit(response(command.id, "set_session_name", {})); return true; }
      emit(response(command.id, command.type, null, false, `${command.type} is not supported by ${label ?? id}`));
      return true;
    },

    stateCommand(id) { return { id, type: "get_state" }; },
    healthCommand(id) { return { id, type: "health_probe" }; },
    startup({ requestId }) { return { commands: [{ id: requestId, type: "get_state" }], resumeResponseId: null }; },
    sessionReference(state, currentReference) {
      const sessionId = state?.sessionId ?? currentReference?.id;
      return sessionId ? { backend: id, id: sessionId, storagePath: null } : null;
    },
  }));
}
