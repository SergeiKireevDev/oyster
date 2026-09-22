import { spawn } from "node:child_process";
import { redactChildOutput } from "./secret-output.mjs";
import { randomUUID } from "node:crypto";
import { validateRunnerDriver } from "./contract.mjs";
import { assistantMessage, claudeRecordMessages } from "./claude-transcript.mjs";
const SESSION_NAME_MAX_CHARS = 80;
const CLAUDE_CODE_HARNESS = "claude-code";


/** Every tool of the `oyster` MCP server; the sudo password prompt is the human gate. */
export const OYSTER_MCP_TOOLS = "mcp__oyster";
const DEFAULT_UI_URL = "http://127.0.0.1:8080";
/** Claude Code's terminal result text when its Anthropic OAuth grant is stale or unusable. */
const OAUTH_FAILURE_RE = /OAuth (?:access token|session) (?:has )?expired|Failed to authenticate/i;

/**
 * Per-launch `--mcp-config` payload pointing at Oyster's own MCP endpoint.
 * The runner, session, and workspace travel with every request as URL
 * parameters, so no process-level configuration describes the caller. Claude
 * Code expands `${OYSTER_TOKEN}` from the inherited environment, which keeps
 * the bearer token off the world-readable command line.
 */
export function oysterMcpConfig({ runnerId = null, sessionId, workdir, uiUrl = DEFAULT_UI_URL }) {
  const params = new URLSearchParams({ session: nonEmpty(sessionId, "session id"), workdir: nonEmpty(workdir, "workdir") });
  if (runnerId) params.set("runner", runnerId);
  const url = `${nonEmpty(uiUrl, "Oyster UI URL").replace(/\/+$/, "")}/mcp?${params}`;
  return { mcpServers: { oyster: { type: "http", url, headers: { Authorization: "Bearer ${OYSTER_TOKEN}" } } } };
}

import { requireTrimmedNonEmptyString as nonEmpty } from "../validation.mjs";

function response(id, command, data, success = true, error = undefined) {
  return { type: "response", id, command, success, ...(success ? { data } : { error: error ?? `${command} is unsupported` }) };
}

function claudeModelRecord(record, provider) {
  if (!record || typeof record !== "object") return null;
  const id = typeof record.value === "string" ? record.value.trim() : "";
  if (!id) return null;
  const resolvedModel = typeof record.resolvedModel === "string" && record.resolvedModel.trim()
    ? record.resolvedModel.trim()
    : null;
  return {
    model: {
      provider,
      id,
      ...(typeof record.displayName === "string" && record.displayName.trim() ? { name: record.displayName.trim() } : {}),
      ...(typeof record.description === "string" && record.description.trim() ? { description: record.description.trim() } : {}),
      ...(resolvedModel ? { resolvedModel } : {}),
      ...(record.disabled === true ? { disabled: true } : {}),
    },
    resolvedModel,
  };
}

function appendCurrentModel(models, seen, resolved, currentModel, provider) {
  const id = typeof currentModel === "string" ? currentModel.trim() : "";
  if (id && !seen.has(id) && !resolved.has(id)) models.push({ provider, id });
}

function availableModels(records, currentModel = null, provider = "anthropic") {
  const models = [];
  const seen = new Set();
  const resolved = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    const parsed = claudeModelRecord(record, provider);
    if (!parsed || seen.has(parsed.model.id)) continue;
    seen.add(parsed.model.id);
    if (parsed.resolvedModel) resolved.add(parsed.resolvedModel);
    models.push(parsed.model);
  }
  appendCurrentModel(models, seen, resolved, currentModel, provider);
  return models;
}

function ensureRuntime(runner) {
  const runtime = runner.driverRuntime ??= {
    sessionId: runner.sessionId ?? null,
    model: null,
    sessionName: runner.sessionName ?? null,
    messages: [],
    streaming: false,
    initialized: Boolean(runner.sessionRef) && runner.sessionInitialized !== false,
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
    sessionInitialized: runtime.initialized,
    model: runtime.model ? { provider: runtime.provider ?? "anthropic", id: runtime.model } : null,
    thinkingLevel: "off",
    messageCount: runtime.messages.length,
    pendingMessageCount: 0,
    isStreaming: runtime.streaming,
    isCompacting: false,
  };
}

function parseRecord(line) {
  try {
    const record = JSON.parse(String(line));
    return record && typeof record === "object" ? record : null;
  } catch {
    return null;
  }
}

function decodeControlResponse(runtime, record) {
  const control = record.response ?? {};
  const pending = runtime.controlRequests.get(control.request_id);
  if (!pending) return [];
  runtime.controlRequests.delete(control.request_id);
  if (pending.command === "health_probe") return [];
  if (pending.command === "get_available_models") return [control.subtype === "success"
    ? response(pending.id, pending.command, { models: availableModels(control.response?.models, runtime.model, runtime.provider) })
    : response(pending.id, pending.command, null, false, String(control.error ?? "Claude Code could not list models"))];
  if (control.subtype === "success") {
    runtime.model = pending.model;
    return [response(pending.id, pending.command, {})];
  }
  return [response(pending.id, pending.command, null, false, String(control.error ?? "Claude Code rejected the model"))];
}

function decodeInitRecord(runner, runtime, record) {
  runtime.initialized = true;
  runtime.sessionId = record.session_id ?? runtime.sessionId;
  runtime.model = record.model ?? runtime.model;
  return [response("_driver-claude-init", "get_state", stateFor(runner, runtime))];
}

function decodeAssistantRecord(runtime, record) {
  const message = assistantMessage(record);
  runtime.model = message.model;
  runtime.streaming = true;
  runtime.messages.push(message);
  for (const block of message.content) if (block.type === "toolCall") runtime.toolNames.set(block.id, block.name);
  return [{ type: "message_start", message }, { type: "message_end", message }];
}

function claudeUserEvent(message) {
  return message.role === "toolResult"
    ? [{ type: "tool_execution_end", toolCallId: message.toolCallId, result: message, isError: message.isError }, { type: "message_end", message }]
    : [{ type: "message_start", message }];
}

function decodeUserRecord(runtime, record) {
  const events = [];
  for (const message of claudeRecordMessages(record, runtime.toolNames)) {
    runtime.messages.push(message);
    events.push(...claudeUserEvent(message));
  }
  return events;
}

function decodeResultRecord(runtime, record) {
  runtime.streaming = false;
  const error = record.is_error ? String(record.result ?? record.terminal_reason ?? "Claude Code failed") : null;
  const events = error === null ? [] : [{ type: "pi_error", error }];
  events.push({ type: "agent_end", willRetry: false }, { type: "agent_settled" });
  if (runtime.provider !== "openrouter" && error !== null && OAUTH_FAILURE_RE.test(error)) {
    events.push({ type: "harness_auth_failed", reason: "oauth_expired", error });
  }
  return events;
}

function sendStateCommand(runner, runtime, command, emit) {
  emit(response(command.id, "get_state", stateFor(runner, runtime)));
  return true;
}

function sendMessagesCommand(runtime, command, emit) {
  emit(response(command.id, "get_messages", { messages: [...runtime.messages] }));
  return true;
}

function sendListModelsControl(runtime, child, command) {
  if (!child?.stdin?.writable) return false;
  const prefix = command.type === "health_probe" ? "oyster-health" : "oyster-models";
  const requestId = `${prefix}-${command.id}`;
  runtime.controlRequests.set(requestId, { id: command.id, command: command.type });
  child.stdin.write(`${JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "list_models" } })}\n`);
  return true;
}

function sendSetModelCommand(runtime, child, command, emit) {
  if (!child?.stdin?.writable) return false;
  if (command.provider !== (runtime.provider ?? "anthropic") || typeof command.modelId !== "string" || !command.modelId.trim()) {
    emit(response(command.id, "set_model", null, false, "Claude Code requires a model from its selected provider"));
    return true;
  }
  const requestId = `oyster-model-${command.id}`;
  const model = command.modelId.trim();
  runtime.controlRequests.set(requestId, { id: command.id, command: command.type, model });
  child.stdin.write(`${JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "set_model", model } })}\n`);
  return true;
}

function sendPromptCommand(runtime, child, command, emit) {
  if (!child?.stdin?.writable) return false;
  const message = { role: "user", content: String(command.message ?? "") };
  const canonical = { role: "user", content: message.content, timestamp: Date.now() };
  if (!runtime.sessionName) runtime.sessionName = message.content.trim().split("\n")[0].slice(0, SESSION_NAME_MAX_CHARS) || "Claude Code session";
  runtime.messages.push(canonical);
  runtime.streaming = true;
  emit({ type: "message_start", message: canonical });
  emit({ type: "agent_start" });
  child.stdin.write(`${JSON.stringify({ type: "user", message, session_id: runtime.sessionId, parent_tool_use_id: null })}\n`);
  emit(response(command.id, "prompt", {}));
  return true;
}

function sendAbortCommand(runtime, child, command, emit) {
  child?.kill?.("SIGINT");
  runtime.streaming = false;
  emit(response(command.id, "abort", {}));
  return true;
}

function sendSetSessionNameCommand(runtime, command, emit) {
  runtime.sessionName = typeof command.name === "string" ? command.name : runtime.sessionName;
  emit(response(command.id, "set_session_name", {}));
  return true;
}

/** Translate Claude Code's headless stream-json protocol into Oyster's canonical runner protocol. */
export function createClaudeCodeDriver({
  bin = "claude",
  extraArgs = [],
  spawnImpl = spawn,
  permissionMode = "default",
  sqlitePath = null,
  env = {},
  resolveRoute = () => null,
  uiUrl = env?.OYSTER_URL ?? DEFAULT_UI_URL,
} = {}) {
  const executable = nonEmpty(bin, "Claude Code executable");
  const mcpUrl = nonEmpty(uiUrl, "Oyster UI URL");
  if (!Array.isArray(extraArgs) || extraArgs.some((arg) => typeof arg !== "string")) throw new TypeError("Claude Code arguments must be strings");
  if (typeof spawnImpl !== "function") throw new TypeError("Claude Code spawn implementation must be a function");
  if (!env || typeof env !== "object" || Array.isArray(env)) throw new TypeError("Claude Code environment must be an object");
  return Object.freeze(validateRunnerDriver({
    id: CLAUDE_CODE_HARNESS,
    label: "Claude Code",

    isSessionCompatible(reference) {
      return !reference || reference.backend === CLAUDE_CODE_HARNESS || (Boolean(sqlitePath) && reference.backend === "sqlite");
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
        ...(runtime.initialized ? ["--resume", sessionId] : ["--session-id", sessionId]),
        "--allowedTools", OYSTER_MCP_TOOLS,
        "--mcp-config", JSON.stringify(oysterMcpConfig({ runnerId: runner.id ?? null, sessionId, workdir: cwd, uiUrl: mcpUrl })),
        ...(systemPrompt ? ["--append-system-prompt", systemPrompt] : []),
        ...extraArgs,
      ];
      // OYSTER_TOKEN must exist for Claude Code's `${OYSTER_TOKEN}` header expansion,
      // even when the server runs unauthenticated.
      const route = resolveRoute();
      runtime.provider = route?.provider ?? "anthropic";
      const environment = { ...globalThis.process.env, OYSTER_TOKEN: "", ...env, ...route?.env };
      const process = spawnImpl(executable, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: environment });
      redactChildOutput(process, [route?.env?.ANTHROPIC_AUTH_TOKEN]);
      return { process, description: `${executable} ${args.join(" ")}` };
    },

    decodeLine(runner, line) {
      const record = parseRecord(line);
      if (!record) return [];
      const runtime = ensureRuntime(runner);
      if (record.type === "control_response") return decodeControlResponse(runtime, record);
      if (record.type === "system" && record.subtype === "init") return decodeInitRecord(runner, runtime, record);
      if (record.session_id) runtime.sessionId = record.session_id;
      if (record.type === "assistant") return decodeAssistantRecord(runtime, record);
      if (record.type === "user") return decodeUserRecord(runtime, record);
      return record.type === "result" ? decodeResultRecord(runtime, record) : [];
    },

    sendCommand(runner, child, command) {
      const runtime = ensureRuntime(runner);
      const emit = (event) => queueMicrotask(() => runner.driverEmit?.(event));
      const handlers = {
        get_state: () => sendStateCommand(runner, runtime, command, emit),
        get_messages: () => sendMessagesCommand(runtime, command, emit),
        health_probe: () => sendListModelsControl(runtime, child, command),
        get_available_models: () => sendListModelsControl(runtime, child, command),
        set_model: () => sendSetModelCommand(runtime, child, command, emit),
        prompt: () => sendPromptCommand(runtime, child, command, emit),
        abort: () => sendAbortCommand(runtime, child, command, emit),
        set_session_name: () => sendSetSessionNameCommand(runtime, command, emit),
      };
      const handler = handlers[command.type];
      if (handler) return handler();
      emit(response(command.id, command.type, null, false, `${command.type} is not supported by Claude Code`));
      return true;
    },

    stateCommand(id) { return { id, type: "get_state" }; },

    // get_state is synthesized from driver memory and therefore cannot prove
    // that the Claude child is responsive. list_models is a native, local
    // control-protocol round trip that produces stdout without invoking a model.
    healthCommand(id) { return { id, type: "health_probe" }; },

    startup({ requestId }) {
      return { commands: [{ id: requestId, type: "get_state" }], resumeResponseId: null };
    },

    sessionReference(state, currentReference) {
      const id = state?.sessionId ?? currentReference?.id;
      if (!id) return null;
      return sqlitePath
        ? { backend: "sqlite", id, storagePath: sqlitePath }
        : { backend: CLAUDE_CODE_HARNESS, id, storagePath: null };
    },
  }));
}
