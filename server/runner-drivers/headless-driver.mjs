import { homedir } from "node:os";
import { join } from "node:path";
import { createCodexSessionModelReader } from "./codex-session-model.mjs";
import { spawn } from "node:child_process";
import { antigravityEvents } from "./antigravity-events.mjs";
import { redactChildOutput } from "./secret-output.mjs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { validateRunnerDriver } from "./contract.mjs";

const BRIDGE = fileURLToPath(new URL("./headless-bridge.mjs", import.meta.url));
const DEFAULT_UI_URL = "http://127.0.0.1:8080";

import { requireTrimmedNonEmptyString as nonEmpty } from "../validation.mjs";

function timestamp(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

import { nonNegativeUsageNumber as finite } from "./usageValues.mjs";

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
    initialized: Boolean(runner.sessionRef) && runner.sessionInitialized !== false,
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
    sessionInitialized: runtime.initialized,
    model: (runtime.selectedModel ?? runtime.model) ? { provider: runtime.provider ?? provider, id: runtime.selectedModel ?? runtime.model } : null,
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

function codexToolShape(item, details) {
  if (item.type === "command_execution") return { name: "shell", args: { command: item.command } };
  if (item.type === "mcp_tool_call") return { name: item.tool ?? "mcp", args: item.arguments };
  if (item.type === "web_search") return { name: item.type, args: { query: item.query } };
  if (item.type === "file_change") return { name: item.type, args: { changes: item.changes ?? [] } };
  if (item.type === "todo_list" || item.type.endsWith("_tool_call")) return { name: item.type, args: details };
  return null;
}

function codexFallbackText(item, details) {
  if (item.type === "todo_list") return (item.items ?? []).map((entry) => `${entry.completed ? "[x]" : "[ ]"} ${entry.text}`).join("\n");
  if (item.type === "file_change") return JSON.stringify(item.changes ?? [], null, 2);
  return item.type.endsWith("_tool_call") && item.type !== "mcp_tool_call"
    ? JSON.stringify(details, null, 2)
    : item.status;
}

function codexTool(item) {
  const { id, type, status, ...details } = item;
  if (!id || typeof type !== "string") return null;
  const shape = codexToolShape(item, details);
  if (!shape) return null;
  const text = item.aggregated_output ?? item.error?.message ?? item.result?.content ?? item.result ?? codexFallbackText(item, details);
  return { id, ...shape, text, isError: ["failed", "declined"].includes(status) || Boolean(item.error), provider: "openai", api: "codex", model: undefined };
}

function codexAssistantMessage(runtime, item) {
  const content = item.type === "reasoning"
    ? [{ type: "thinking", thinking: String(item.text ?? "") }]
    : [{ type: "text", text: String(item.text ?? "") }];
  const message = assistant(runtime, { provider: "openai", api: "codex", model: runtime.model, content });
  return [{ type: "message_start", message }, { type: "message_end", message }];
}

function decodeCodexToolProgress(runtime, record) {
  const events = [];
  const tool = codexTool(record.item ?? {});
  if (!tool) return events;
  if (!runtime.toolNames.has(tool.id)) startTool(runtime, events, tool);
  if (record.type === "item.updated" || ["file_change", "todo_list"].includes(record.item.type)) {
    events.push({ type: "tool_execution_update", toolCallId: tool.id, toolName: tool.name,
      partialResult: { content: [{ type: "text", text: resultText(tool.text) }] } });
  }
  return events;
}

function decodeCodexCompletedItem(runtime, item) {
  if (item.type === "agent_message" || item.type === "reasoning") return codexAssistantMessage(runtime, item);
  if (item.type === "error") return [{ type: "pi_error", error: String(item.message ?? "Codex reported an error") }];
  const tool = codexTool(item);
  if (!tool) return [];
  const events = [];
  if (!runtime.toolNames.has(tool.id)) startTool(runtime, events, tool);
  endTool(runtime, events, tool);
  return events;
}

function settleCodex(runtime, extraEvents = []) {
  runtime.streaming = false;
  return [...extraEvents, { type: "agent_end", willRetry: false }, { type: "agent_settled" }];
}

function decodeCodex(runtime, record) {
  if (record.type === "oyster.bridge.session_model" && typeof record.model === "string" && record.model.trim()) {
    runtime.model = record.model;
    runtime.selectedModel = null;
    return [];
  }
  if (record.type === "thread.started" && record.thread_id) {
    runtime.sessionId = record.thread_id;
    runtime.initialized = true;
    return [];
  }
  if (record.type === "item.started" || record.type === "item.updated") return decodeCodexToolProgress(runtime, record);
  if (record.type === "item.completed") return decodeCodexCompletedItem(runtime, record.item ?? {});
  if (record.type === "turn.completed") return settleCodex(runtime);
  if (record.type === "turn.failed") return settleCodex(runtime, [{ type: "pi_error", error: String(record.error?.message ?? "Codex failed") }]);
  return record.type === "error" ? [{ type: "pi_error", error: String(record.message ?? "Codex reported an error") }] : [];
}

function geminiAssistantDelta(runtime, record, provider, api) {
  const events = [];
  const delta = String(record.content ?? "");
  if (!runtime.currentMessage) {
    runtime.currentMessage = assistant(runtime, { provider, api, model: runtime.model, at: record.timestamp, content: [{ type: "text", text: "" }] });
    events.push({ type: "message_start", message: runtime.currentMessage });
  }
  runtime.currentMessage.content[0].text += delta;
  events.push({ type: "message_update", message: runtime.currentMessage, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta, partial: runtime.currentMessage } });
  return events;
}

function decodeGemini(runtime, record, provider = "google", api = "gemini-cli") {
  if (record.type === "init") {
    runtime.sessionId = record.session_id ?? runtime.sessionId;
    runtime.model = record.model ?? runtime.model;
    runtime.initialized = true;
    return [];
  }
  if (record.type === "message" && record.role === "assistant") return geminiAssistantDelta(runtime, record, provider, api);
  if (record.type === "tool_use") {
    const events = [];
    startTool(runtime, events, { id: String(record.tool_id ?? "tool"), name: String(record.tool_name ?? "tool"), args: record.parameters, provider, api, model: runtime.model, at: record.timestamp });
    return events;
  }
  if (record.type === "tool_result") {
    const events = [];
    endTool(runtime, events, { id: String(record.tool_id ?? "tool"), text: record.output ?? record.error?.message, isError: record.status === "error", at: record.timestamp });
    return events;
  }
  if (record.type === "error") return [{ type: "pi_error", error: String(record.message ?? "Gemini CLI reported an error") }];
  if (record.type !== "result") return [];
  const events = [];
  finishStreamingMessage(runtime, events, record.status === "error" ? "error" : "stop");
  runtime.streaming = false;
  if (record.status === "error") events.push({ type: "pi_error", error: String(record.error?.message ?? "Gemini CLI failed") });
  events.push({ type: "agent_end", willRetry: false }, { type: "agent_settled" });
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

function ampStopSettles(record) {
  return Boolean(record.message?.stop_reason) && record.message.stop_reason !== "tool_use" && record.message.stop_reason !== "pause_turn";
}

function decodeAmpAssistant(runtime, record) {
  const events = [];
  const message = ampAssistant(runtime, record);
  events.push({ type: "message_start", message }, { type: "message_end", message });
  for (const block of message.content) if (block.type === "toolCall") {
    runtime.toolNames.set(block.id, block.name);
    events.push({ type: "tool_execution_start", toolCallId: block.id, toolName: block.name, args: block.arguments });
  }
  if (ampStopSettles(record)) {
    runtime.streaming = false;
    events.push({ type: "agent_end", willRetry: false }, { type: "agent_settled" });
  }
  return events;
}

function decodeAmpUser(runtime, record) {
  const events = [];
  const blocks = Array.isArray(record.message?.content) ? record.message.content : [];
  for (const block of blocks) if (block?.type === "tool_result" && block.tool_use_id) {
    endTool(runtime, events, { id: String(block.tool_use_id), text: block.content, isError: block.is_error, at: record.timestamp });
  }
  return events;
}

function decodeAmpResult(runtime, record) {
  const events = record.is_error ? [{ type: "pi_error", error: String(record.error ?? record.result ?? "Amp failed") }] : [];
  if (runtime.streaming) {
    runtime.streaming = false;
    events.push({ type: "agent_end", willRetry: false }, { type: "agent_settled" });
  }
  return events;
}

function decodeAmp(runtime, record) {
  if (record.type === "system" && record.subtype === "init") {
    runtime.sessionId = record.session_id ?? runtime.sessionId;
    runtime.initialized = true;
    return [];
  }
  if (record.type === "assistant") return decodeAmpAssistant(runtime, record);
  if (record.type === "user") return decodeAmpUser(runtime, record);
  if (record.type === "system" && record.error) return [{ type: "pi_error", error: String(record.error) }];
  return record.type === "result" ? decodeAmpResult(runtime, record) : [];
}

function validateHeadlessOptions({ id, label, kind, extraArgs, spawnImpl, env, bridgeOptions }) {
  if (!["codex", "gemini", "amp", "antigravity"].includes(kind)) throw new TypeError(`unsupported headless bridge kind: ${kind}`);
  if (!Array.isArray(extraArgs) || extraArgs.some((arg) => typeof arg !== "string")) throw new TypeError(`${label ?? id} arguments must be strings`);
  if (typeof spawnImpl !== "function") throw new TypeError(`${label ?? id} spawn implementation must be a function`);
  if (!env || typeof env !== "object" || Array.isArray(env)) throw new TypeError(`${label ?? id} environment must be an object`);
  if (!bridgeOptions || typeof bridgeOptions !== "object" || Array.isArray(bridgeOptions)) throw new TypeError(`${label ?? id} bridge options must be an object`);
}

function routeProviderChanged(runtime, provider) {
  return (runtime.provider ?? provider) !== provider;
}

function maybeLoadCodexResumeModel({ kind, runtime, bridgeOptions, env }) {
  if (kind !== "codex" || !runtime.initialized || runtime.model) return;
  const home = bridgeOptions.codexHome || env.CODEX_HOME || process.env.CODEX_HOME || join(homedir(), ".codex");
  runtime.model = createCodexSessionModelReader(home, runtime.sessionId)();
}

function bridgeConfigFor({ kind, executable, cwd, extraArgs, systemPrompt, mcpUrl, sandbox, approvalMode, bridgeOptions, runtime, route }) {
  return {
    ...(kind === "codex" && runtime.initialized ? { resumeSessionId: runtime.sessionId } : {}),
    kind, bin: executable, cwd, extraArgs, systemPrompt, mcpUrl, sandbox, approvalMode,
    ...bridgeOptions,
    ...(route ? { provider: route.provider } : {}),
  };
}

function decodeHeadlessRecord({ kind, runtime, record }) {
  if (kind === "codex") return decodeCodex(runtime, record);
  if (kind === "gemini") return decodeGemini(runtime, record);
  if (kind === "antigravity") return antigravityEvents(runtime, record).flatMap((event) => decodeGemini(runtime, event, "antigravity", "antigravity-cli"));
  return decodeAmp(runtime, record);
}

function parseBridgeRecord(line) {
  try {
    const record = JSON.parse(String(line));
    return record && typeof record === "object" && !Array.isArray(record) ? record : null;
  } catch {
    return null;
  }
}

function modelResponseEvents(runtime, record, kind) {
  if (record.error) return [response(record.id, "get_available_models", null, false, record.error)];
  runtime.availableModels = Array.isArray(record.models) ? record.models : [];
  return [response(record.id, "get_available_models", { models: runtime.availableModels, selectionLabel: kind === "amp" ? "mode" : "model" })];
}

function turnStartEvents(runtime) {
  runtime.bridgeTurnCompleted = false;
  runtime.streaming = true;
  return [{ type: "agent_start" }];
}

function turnExitError({ record, label, id }) {
  return record.error || (record.code !== 0 ? String(record.stderr || `${label ?? id} exited with code ${record.code}`).trim() : null);
}

function turnExitEvents({ runner, runtime, record, kind, label, id, persistTranscript }) {
  if (runtime.bridgeTurnCompleted) {
    runtime.bridgeTurnCompleted = false;
    return [];
  }
  if (!runtime.streaming) return [];
  runtime.streaming = false;
  const error = turnExitError({ record, label, id });
  const events = [];
  finishStreamingMessage(runtime, events, error ? "error" : "stop");
  persistTranscript(runner, runtime);
  if (error) events.push({ type: "pi_error", error });
  if (error && runtime.provider !== "openrouter" && kind !== "amp" && isAuthenticationFailure(error)) events.push({ type: "harness_auth_failed", reason: `${kind}_oauth` });
  events.push({ type: "agent_end", willRetry: false }, { type: "agent_settled" });
  return events;
}

function appendHeadlessStateChanges({ events, kind, runner, runtime, previous, provider }) {
  if (events.some((event) => event.type === "agent_settled")) runtime.bridgeTurnCompleted = true;
  if ((!previous.initialized && runtime.initialized) || previous.sessionId !== runtime.sessionId || previous.model !== runtime.model) {
    events.push(response(`_driver-${kind}-state`, "get_state", stateFor(runner, runtime, provider)));
  }
}

function appendHeadlessAuthFailure({ events, kind, runtime, record }) {
  const explicitError = record.type === "error" || record.type === "turn.failed" || record.is_error === true
    ? record.error ?? record.message ?? record.result : null;
  if (runtime.provider !== "openrouter" && kind !== "amp" && explicitError && isAuthenticationFailure(explicitError)) {
    events.push({ type: "harness_auth_failed", reason: `${kind}_oauth` });
  }
}

function writeBridgeCommand(child, payload) {
  if (!child?.stdin?.writable) return false;
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  return true;
}

function sendHeadlessState({ runner, command, runtime, emit, provider }) {
  emit(response(command.id, "get_state", stateFor(runner, runtime, provider)));
  return true;
}

function sendHeadlessMessages({ command, runtime, emit }) {
  emit(response(command.id, "get_messages", { messages: [...runtime.messages] }));
  return true;
}

function canSelectHeadlessModel(runtime, provider, command) {
  return command.provider === (runtime.provider ?? provider)
    && typeof command.modelId === "string"
    && runtime.availableModels?.some((model) => model.provider === (runtime.provider ?? provider) && model.id === command.modelId && !model.disabled);
}

function sendHeadlessSetModel({ command, runtime, emit, provider, label, id }) {
  if (runtime.streaming) {
    emit(response(command.id, "set_model", null, false, "Wait for the current turn before changing models"));
    return true;
  }
  if (!canSelectHeadlessModel(runtime, provider, command)) {
    emit(response(command.id, "set_model", null, false, `${label ?? id} requires a ${provider} model`));
    return true;
  }
  runtime.selectedModel = command.modelId;
  runtime.model = command.modelId;
  emit(response(command.id, "set_model", {}));
  return true;
}

function promptPayload({ text, generateSessionId, runtime, kind }) {
  return {
    type: "run",
    prompt: text,
    sessionId: generateSessionId || runtime.initialized ? runtime.sessionId : null,
    resume: runtime.initialized,
    steer: runtime.streaming,
    model: kind === "amp" ? runtime.selectedModel ?? null : runtime.selectedModel ?? runtime.model,
  };
}

function sendHeadlessPrompt({ runner, child, command, runtime, emit, label, id, kind, generateSessionId, persistTranscript }) {
  if (!child?.stdin?.writable) return false;
  const text = String(command.message ?? "");
  const message = { role: "user", content: text, timestamp: Date.now() };
  if (!runtime.sessionName) runtime.sessionName = text.trim().split("\n")[0].slice(0, 80) || `${label ?? id} session`;
  runtime.messages.push(message);
  persistTranscript(runner, runtime);
  const payload = promptPayload({ text, generateSessionId, runtime, kind });
  runtime.streaming = true;
  emit({ type: "message_start", message });
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  emit(response(command.id, "prompt", {}));
  return true;
}

function sendHeadlessAbort({ runner, child, command, runtime, emit, persistTranscript }) {
  if (!writeBridgeCommand(child, { type: "abort" })) return false;
  if (runtime.streaming) {
    const completed = [];
    finishStreamingMessage(runtime, completed, "aborted");
    for (const event of completed) emit(event);
    persistTranscript(runner, runtime);
    runtime.streaming = false;
    runtime.bridgeTurnCompleted = true;
    emit({ type: "agent_end", willRetry: false });
    emit({ type: "agent_settled" });
  }
  emit(response(command.id, "abort", {}));
  return true;
}

function sendHeadlessSessionName({ runner, command, runtime, emit, persistTranscript }) {
  runtime.sessionName = typeof command.name === "string" ? command.name : runtime.sessionName;
  persistTranscript(runner, runtime);
  emit(response(command.id, "set_session_name", {}));
  return true;
}

export function createHeadlessDriver({
  id, label, bin, kind = id, provider, extraArgs = [], spawnImpl = spawn, env = {}, uiUrl = env?.OYSTER_URL ?? DEFAULT_UI_URL,
  sandbox = "workspace-write", approvalMode = "auto_edit", generateSessionId = false, defaultModel = null,
  bridgeOptions = {}, sqlitePath = null, transcriptSink = null, resolveRoute = () => null,
} = {}) {
  id = nonEmpty(id, "headless driver id");
  const executable = nonEmpty(bin, `${label ?? id} executable`);
  provider = nonEmpty(provider, `${label ?? id} provider`);
  validateHeadlessOptions({ id, label, kind, extraArgs, spawnImpl, env, bridgeOptions });

  function persistTranscript(runner, runtime) {
    // Provisional IDs belong to the runner record only. Wait for the native
    // identity before creating transcript rows, including queued user messages.
    if (!transcriptSink || !runtime.sessionId || !runtime.initialized) return;
    runtime.transcriptIds ??= new WeakMap();
    runtime.transcriptQueued ??= new Set();
    runtime.transcriptBatches ??= [];
    const completed = runtime.messages.filter((message) => message !== runtime.currentMessage && !runtime.transcriptQueued.has(message));
    if (completed.length || runtime.transcriptName !== runtime.sessionName) {
      const entries = completed.map((message) => {
        if (!runtime.transcriptIds.has(message)) runtime.transcriptIds.set(message, randomUUID());
        runtime.transcriptQueued.add(message);
        return { id: runtime.transcriptIds.get(message), message };
      });
      runtime.transcriptName = runtime.sessionName;
      runtime.transcriptBatches.push(structuredClone({ harness: id, sessionId: runtime.sessionId, cwd: runtime.cwd ?? runner.dir,
        name: runtime.sessionName, entries }));
    }
    if (runtime.transcriptPending || !runtime.transcriptBatches.length) return;
    runtime.transcriptPending = (async () => {
      // A failed batch stays at the head: later events retry it before appending newer messages.
      while (runtime.transcriptBatches.length) {
        await transcriptSink.append(runtime.transcriptBatches[0]);
        runtime.transcriptBatches.shift();
      }
      if (runner.driverRuntime === runtime) runner.driverEmit?.(response(`_driver-${kind}-saved`, "get_state", stateFor(runner, runtime, provider)));
    })().catch((error) => {
      const message = `Could not persist ${label ?? id} transcript: ${error.message}`;
      if (runner.driverEmit) runner.driverEmit({ type: "pi_error", error: message });
      else console.error(`[oyster] ${message}`);
    }).finally(() => { runtime.transcriptPending = null; });
  }

  return Object.freeze(validateRunnerDriver({
    id, label: label ?? id,
    isSessionCompatible(reference) { return !reference || reference.backend === id || (Boolean(sqlitePath) && reference.backend === "sqlite"); },

    launch({ runner, cwd, systemPrompt }) {
      const provisionalId = runner.sessionRef?.id ?? runner.sessionId ?? randomUUID();
      const runtime = runtimeFor(runner, { sessionId: provisionalId, model: defaultModel, systemPrompt });
      runtime.cwd = cwd;
      const route = resolveRoute();
      const nextProvider = route?.provider ?? provider;
      if (routeProviderChanged(runtime, nextProvider)) {
        runtime.selectedModel = null;
        runtime.model = null;
        runtime.availableModels = [];
      }
      runtime.provider = nextProvider;
      maybeLoadCodexResumeModel({ kind, runtime, bridgeOptions, env });
      const mcpUrl = oysterMcpUrl({ runnerId: runner.id ?? null, sessionId: provisionalId, workdir: cwd, uiUrl });
      const bridgeConfig = bridgeConfigFor({ kind, executable, cwd, extraArgs, systemPrompt, mcpUrl, sandbox, approvalMode, bridgeOptions, runtime, route });
      const environment = { ...globalThis.process.env, OYSTER_TOKEN: "", ...env, ...route?.env, OYSTER_HEADLESS_BRIDGE_CONFIG: JSON.stringify(bridgeConfig) };
      const childProcess = spawnImpl(globalThis.process.execPath, [BRIDGE], { cwd, stdio: ["pipe", "pipe", "pipe"], env: environment });
      redactChildOutput(childProcess, [route?.env?.OPENROUTER_API_KEY]);
      return { process: childProcess, description: `${label ?? id} bridge (${executable})` };
    },

    decodeLine(runner, line) {
      const record = parseBridgeRecord(line);
      if (!record) return [];
      const runtime = runtimeFor(runner, { model: defaultModel });
      if (record.type === "oyster.bridge.pong") return [];
      if (record.type === "oyster.bridge.models") return modelResponseEvents(runtime, record, kind);
      if (record.type === "oyster.bridge.turn_start") return turnStartEvents(runtime);
      if (record.type === "oyster.bridge.turn_exit") return turnExitEvents({ runner, runtime, record, kind, label, id, persistTranscript });
      const previous = { sessionId: runtime.sessionId, model: runtime.model, initialized: runtime.initialized };
      const events = decodeHeadlessRecord({ kind, runtime, record });
      appendHeadlessStateChanges({ events, kind, runner, runtime, previous, provider });
      appendHeadlessAuthFailure({ events, kind, runtime, record });
      persistTranscript(runner, runtime);
      return events;
    },

    sendCommand(runner, child, command) {
      const runtime = runtimeFor(runner, { model: defaultModel });
      const emit = (event) => queueMicrotask(() => runner.driverEmit?.(event));
      const context = { runner, child, command, runtime, emit, provider, label, id, kind, generateSessionId, persistTranscript };
      const handlers = {
        get_state: () => sendHeadlessState(context),
        get_messages: () => sendHeadlessMessages(context),
        health_probe: () => writeBridgeCommand(child, { type: "health", id: command.id }),
        get_available_models: () => writeBridgeCommand(child, { type: "models", id: command.id }),
        set_model: () => sendHeadlessSetModel(context),
        prompt: () => sendHeadlessPrompt(context),
        abort: () => sendHeadlessAbort(context),
        set_session_name: () => sendHeadlessSessionName(context),
      };
      const handler = handlers[command.type];
      if (handler) return handler();
      emit(response(command.id, command.type, null, false, `${command.type} is not supported by ${label ?? id}`));
      return true;
    },

    async flushTranscript(runner) {
      const runtime = runner.driverRuntime;
      if (!runtime || !transcriptSink) return;
      finishStreamingMessage(runtime, [], "aborted");
      runtime.streaming = false;
      persistTranscript(runner, runtime);
      await runtime.transcriptPending;
      if (runtime.transcriptBatches?.length) throw new Error("Native transcript still has unpersisted messages");
    },

    stateCommand(id) { return { id, type: "get_state" }; },
    healthCommand(id) { return { id, type: "health_probe" }; },
    startup({ requestId }) { return { commands: [{ id: requestId, type: "get_state" }], resumeResponseId: null }; },
    sessionReference(state, currentReference) {
      const sessionId = state?.sessionId ?? currentReference?.id;
      return sessionId ? (sqlitePath
        ? { backend: "sqlite", id: sessionId, storagePath: sqlitePath }
        : { backend: id, id: sessionId, storagePath: null }) : null;
    },
  }));
}
