import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createClaudeCodeDriver } from "../server/runner-drivers/claude-code.mjs";
import { createRunnerDriverRegistry } from "../server/runner-drivers/registry.mjs";

function fakeProcess() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = (signal) => { child.signal = signal; };
  return child;
}

function line(stream) {
  return JSON.parse(String(stream.read()).trim());
}

function driverStub(id, backend = id) {
  return {
    id, label: id,
    isSessionCompatible: (reference) => !reference || reference.backend === backend,
    launch() {}, decodeLine() {}, sendCommand() {}, stateCommand() {}, startup() {}, sessionReference() {},
  };
}

test("runner driver registry selects defaults and compatible harnesses", () => {
  const registry = createRunnerDriverRegistry({ drivers: [driverStub("pi", "sqlite"), driverStub("claude-code")], defaultId: "pi" });
  assert.equal(registry.get().id, "pi");
  assert.equal(registry.get("claude-code").label, "claude-code");
  assert.equal(registry.compatible({ backend: "claude-code" }).id, "claude-code");
  assert.deepEqual(registry.list(), [{ id: "pi", label: "pi" }, { id: "claude-code", label: "claude-code" }]);
  assert.throws(() => registry.get("missing"), /harness is unavailable/);
  assert.throws(() => createRunnerDriverRegistry({ drivers: [driverStub("pi"), driverStub("pi")] }), /duplicate/);
});

test("Claude Code driver launches new and resumed stream-json sessions", () => {
  const launches = [];
  const driver = createClaudeCodeDriver({
    bin: "/bin/claude",
    extraArgs: ["--model", "sonnet"],
    permissionMode: "acceptEdits",
    spawnImpl(bin, args, options) { const child = fakeProcess(); launches.push({ bin, args, options, child }); return child; },
  });
  const fresh = { sessionRef: null, sessionId: null };
  driver.launch({ runner: fresh, cwd: "/work", systemPrompt: "policy" });
  assert.equal(launches[0].bin, "/bin/claude");
  assert.deepEqual(launches[0].args.slice(0, 8), [
    "--print", "--verbose", "--input-format", "stream-json", "--output-format", "stream-json", "--permission-mode", "acceptEdits",
  ]);
  assert.ok(launches[0].args.includes("--session-id"));
  assert.deepEqual(launches[0].args.slice(-4), ["--append-system-prompt", "policy", "--model", "sonnet"]);

  const resumed = { sessionRef: { backend: "claude-code", id: "cc-session", storagePath: null }, sessionId: "cc-session" };
  driver.launch({ runner: resumed, cwd: "/work", systemPrompt: "" });
  assert.deepEqual(launches[1].args.slice(8, 10), ["--resume", "cc-session"]);
  assert.equal(driver.isSessionCompatible(resumed.sessionRef), true);
  assert.equal(driver.isSessionCompatible({ backend: "sqlite" }), false);

  const mirrored = createClaudeCodeDriver({ bin: "/bin/claude", sqlitePath: "/agent/sessions.sqlite", spawnImpl: () => fakeProcess() });
  assert.equal(mirrored.isSessionCompatible({ backend: "sqlite", id: "cc-session", storagePath: "/agent/sessions.sqlite" }), true);
  assert.deepEqual(mirrored.sessionReference({ sessionId: "cc-session" }), {
    backend: "sqlite", id: "cc-session", storagePath: "/agent/sessions.sqlite",
  });
});

test("installed Claude Code accepts the driver's stream-json launch contract", {
  skip: !existsSync("/tmp/oyster-claude-code/node_modules/.bin/claude"),
  timeout: 20_000,
}, async (t) => {
  const home = mkdtempSync(join(tmpdir(), "oyster-claude-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome; });
  const driver = createClaudeCodeDriver({ bin: "/tmp/oyster-claude-code/node_modules/.bin/claude" });
  const runner = { sessionRef: null, sessionId: null, sessionName: null };
  const { process: child } = driver.launch({ runner, cwd: home, systemPrompt: "Reply briefly." });
  driver.sendCommand(runner, child, { id: "native-model", type: "set_model", provider: "anthropic", modelId: "sonnet" });
  const records = [];
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) if (line.trim()) records.push(JSON.parse(line));
  });
  child.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content: "Reply OK" } })}\n`);
  await once(child, "exit");
  assert.equal(records.some((record) => record.type === "system" && record.subtype === "init"), true);
  assert.equal(records.some((record) => record.type === "assistant"), true);
  assert.equal(records.some((record) => record.type === "result"), true);
  const canonical = records.flatMap((record) => driver.decodeLine(runner, JSON.stringify(record)));
  assert.equal(canonical.some((event) => event.type === "message_end"), true);
  assert.equal(canonical.some((event) => event.type === "agent_settled"), true);
  assert.equal(canonical.some((event) => event.type === "response" && event.id === "native-model" && event.success), true);
});

test("Claude Code driver translates init, messages, tools, results, and local RPC state", async () => {
  const driver = createClaudeCodeDriver({ bin: "/bin/claude", spawnImpl: () => fakeProcess() });
  const runner = { sessionId: null, sessionName: null, sessionRef: null };
  const child = fakeProcess();
  const localEvents = [];
  runner.driverEmit = (event) => localEvents.push(event);

  assert.equal(driver.sendCommand(runner, child, { id: "state-before", type: "get_state" }), true);
  assert.deepEqual(driver.decodeLine(runner, JSON.stringify({ type: "system", subtype: "init", session_id: "cc-1", model: "claude-sonnet-4-5" })), [{
    type: "response", id: "state-before", command: "get_state", success: true,
    data: {
      sessionId: "cc-1", sessionName: null, sessionFile: null,
      model: { provider: "anthropic", id: "claude-sonnet-4-5" }, thinkingLevel: "off",
      messageCount: 0, pendingMessageCount: 0, isStreaming: false, isCompacting: false,
    },
  }]);

  driver.sendCommand(runner, child, { id: "prompt-1", type: "prompt", message: "hello" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(line(child.stdin), {
    type: "user", message: { role: "user", content: "hello" }, session_id: "cc-1", parent_tool_use_id: null,
  });
  assert.deepEqual(localEvents.map((event) => event.type), ["message_start", "agent_start", "response"]);

  const assistantEvents = driver.decodeLine(runner, JSON.stringify({
    type: "assistant", session_id: "cc-1", timestamp: "2026-01-02T03:04:05.000Z",
    message: {
      id: "msg-1", model: "claude-sonnet-4-5", stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 },
      content: [{ type: "thinking", thinking: "plan" }, { type: "text", text: "Running it" }, { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "pwd" } }],
    },
  }));
  assert.deepEqual(assistantEvents.map((event) => event.type), ["message_start", "message_end"]);
  assert.equal(assistantEvents[1].message.stopReason, "toolUse");
  assert.equal(assistantEvents[1].message.usage.totalTokens, 19);
  assert.deepEqual(assistantEvents[1].message.content[2], { type: "toolCall", id: "tool-1", name: "Bash", arguments: { command: "pwd" } });

  const toolEvents = driver.decodeLine(runner, JSON.stringify({
    type: "user", session_id: "cc-1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok" }] },
  }));
  assert.deepEqual(toolEvents.map((event) => event.type), ["tool_execution_end", "message_end"]);
  assert.equal(toolEvents[1].message.toolName, "Bash");
  assert.equal(toolEvents[1].message.content[0].text, "ok");

  driver.sendCommand(runner, child, { id: "models", type: "get_available_models" });
  assert.deepEqual(line(child.stdin), {
    type: "control_request", request_id: "oyster-models-models", request: { subtype: "list_models" },
  });
  const modelEvents = driver.decodeLine(runner, JSON.stringify({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: "oyster-models-models",
      response: { models: [
        { value: "default", resolvedModel: "claude-sonnet-5", displayName: "Default (recommended)", description: "Sonnet 5" },
        { value: "astra", resolvedModel: "claude-astra-1", displayName: "Astra" },
        { value: "astra", resolvedModel: "duplicate" },
        { value: "disabled-model", displayName: "Disabled", disabled: true },
        { displayName: "Missing value" },
      ] },
    },
  }));
  assert.deepEqual(modelEvents, [{
    type: "response", id: "models", command: "get_available_models", success: true,
    data: { models: [
      { provider: "anthropic", id: "default", name: "Default (recommended)", description: "Sonnet 5", resolvedModel: "claude-sonnet-5" },
      { provider: "anthropic", id: "astra", name: "Astra", resolvedModel: "claude-astra-1" },
      { provider: "anthropic", id: "disabled-model", name: "Disabled", disabled: true },
      { provider: "anthropic", id: "claude-sonnet-4-5" },
    ] },
  }]);
  driver.sendCommand(runner, child, { id: "models-error", type: "get_available_models" });
  assert.deepEqual(line(child.stdin).request, { subtype: "list_models" });
  assert.deepEqual(driver.decodeLine(runner, JSON.stringify({
    type: "control_response", response: { subtype: "error", request_id: "oyster-models-models-error", error: "catalog unavailable" },
  })), [{
    type: "response", id: "models-error", command: "get_available_models", success: false, error: "catalog unavailable",
  }]);
  assert.equal(driver.sendCommand(runner, child, { id: "model-1", type: "set_model", provider: "anthropic", modelId: "opus" }), true);
  assert.deepEqual(line(child.stdin), {
    type: "control_request", request_id: "oyster-model-model-1", request: { subtype: "set_model", model: "opus" },
  });
  assert.deepEqual(driver.decodeLine(runner, JSON.stringify({
    type: "control_response", response: { subtype: "success", request_id: "oyster-model-model-1" },
  })), [{ type: "response", id: "model-1", command: "set_model", success: true, data: {} }]);

  assert.deepEqual(driver.decodeLine(runner, JSON.stringify({ type: "result", subtype: "success", session_id: "cc-1" })), [
    { type: "agent_end", willRetry: false }, { type: "agent_settled" },
  ]);
  driver.sendCommand(runner, child, { id: "messages", type: "get_messages" });
  await new Promise((resolve) => setImmediate(resolve));
  const snapshot = localEvents.find((event) => event.id === "messages");
  assert.equal(snapshot.success, true);
  assert.equal(snapshot.data.messages.length, 3);
  driver.sendCommand(runner, child, { id: "state-after-model", type: "get_state" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(localEvents.find((event) => event.id === "state-after-model").data.model, { provider: "anthropic", id: "opus" });
  assert.deepEqual(driver.sessionReference({ sessionId: "cc-1" }), { backend: "claude-code", id: "cc-1", storagePath: null });
});
