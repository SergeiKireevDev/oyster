import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createAmpDriver } from "../server/runner-drivers/amp.mjs";
import { createCodexDriver } from "../server/runner-drivers/codex.mjs";
import { createGeminiDriver } from "../server/runner-drivers/gemini.mjs";
import { createConfiguredRunnerDrivers } from "../server/runner-drivers/configured.mjs";

function fakeProcess() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.exitCode = null; child.kill = (signal) => { child.signal = signal; };
  return child;
}

function line(stream) { return JSON.parse(String(stream.read()).trim()); }
async function tick() { await new Promise((resolve) => setImmediate(resolve)); }

function launchDriver(factory, options = {}) {
  const launches = [];
  const driver = factory({
    bin: `/opt/${options.kind}`,
    env: { OYSTER_URL: "http://127.0.0.1:9090", OYSTER_TOKEN: "secret" },
    spawnImpl(bin, args, spawnOptions) { const child = fakeProcess(); launches.push({ bin, args, options: spawnOptions, child }); return child; },
    ...options,
  });
  const runner = { id: `r-${options.kind}`, sessionRef: null, sessionId: null, sessionName: null };
  driver.launch({ runner, cwd: "/work", systemPrompt: "artifact policy" });
  return { driver, runner, launch: launches[0] };
}

test("configured driver registry exposes every installed harness", () => {
  const config = {
    PI_BIN: "/opt/pi", PI_EXTRA_ARGS: [], PERSISTENT_STORE: "sqlite", SQLITE_PATH: "/agent/sessions.sqlite",
    CLAUDE_CODE_BIN: "/opt/claude", CLAUDE_CODE_ARGS: [], CLAUDE_CODE_PERMISSION_MODE: "acceptEdits",
    CODEX_BIN: "/opt/codex", CODEX_ARGS: [], CODEX_SANDBOX: "workspace-write", CODEX_HOME: "/agent/codex",
    GEMINI_BIN: "/opt/gemini", GEMINI_ARGS: [], GEMINI_APPROVAL_MODE: "auto_edit", GEMINI_OAUTH_PATH: "/agent/gemini-oauth.json",
    AMP_BIN: "/opt/amp", AMP_ARGS: [], AMP_SETTINGS_PATH: "/agent/amp-settings.json",
    PI_AGENT_DIR: "/agent", TOKEN: "secret", PORT: 8080,
  };
  const registry = createConfiguredRunnerDrivers({ config, piProcesses: { bin: "/opt/pi", launch: () => fakeProcess() } });
  assert.deepEqual(registry.list(), [
    { id: "pi", label: "pi" },
    { id: "claude-code", label: "Claude Code" },
    { id: "codex", label: "Codex" },
    { id: "gemini", label: "Gemini CLI" },
    { id: "amp", label: "Amp" },
  ]);
});

test("headless harnesses launch the durable bridge with private per-runner MCP configuration", () => {
  for (const [factory, kind] of [[createCodexDriver, "codex"], [createGeminiDriver, "gemini"], [createAmpDriver, "amp"]]) {
    const { launch } = launchDriver(factory, { kind, extraArgs: ["--extra"] });
    assert.equal(launch.bin, process.execPath);
    assert.match(launch.args[0], /headless-bridge\.mjs$/);
    const config = JSON.parse(launch.options.env.OYSTER_HEADLESS_BRIDGE_CONFIG);
    assert.equal(config.kind, kind);
    assert.equal(config.bin, `/opt/${kind}`);
    assert.deepEqual(config.extraArgs, ["--extra"]);
    assert.equal(config.systemPrompt, "artifact policy");
    assert.match(config.mcpUrl, new RegExp(`^http://127\\.0\\.0\\.1:9090/mcp\\?.*runner=r-${kind}`));
    assert.equal(launch.options.env.OYSTER_TOKEN, "secret");
    assert.ok(!launch.args.some((arg) => arg.includes("secret")));
  }
});

test("Codex driver translates JSONL turns, tools, messages, state, resume identity, and model selection", async () => {
  const { driver, runner, launch } = launchDriver(createCodexDriver, { kind: "codex" });
  const emitted = [];
  runner.driverEmit = (event) => emitted.push(event);

  driver.sendCommand(runner, launch.child, { id: "prompt", type: "prompt", message: "fix it" });
  await tick();
  assert.deepEqual(line(launch.child.stdin), { type: "run", prompt: "fix it", sessionId: null, resume: false, steer: false, model: null });
  assert.deepEqual(emitted.map((event) => event.type), ["message_start", "response"]);
  assert.deepEqual(driver.decodeLine(runner, '{"type":"oyster.bridge.turn_start"}'), [{ type: "agent_start" }]);
  const identity = driver.decodeLine(runner, '{"type":"thread.started","thread_id":"codex-thread"}');
  assert.deepEqual(identity.map((event) => [event.type, event.command]), [["response", "get_state"]]);
  assert.equal(identity[0].data.sessionId, "codex-thread");
  const started = driver.decodeLine(runner, JSON.stringify({ type: "item.started", item: { id: "cmd-1", type: "command_execution", command: "npm test", status: "in_progress" } }));
  assert.deepEqual(started.map((event) => event.type), ["message_start", "message_end", "tool_execution_start"]);
  const completed = driver.decodeLine(runner, JSON.stringify({ type: "item.completed", item: { id: "cmd-1", type: "command_execution", command: "npm test", status: "completed", aggregated_output: "ok" } }));
  assert.deepEqual(completed.map((event) => event.type), ["tool_execution_end", "message_end"]);
  const answer = driver.decodeLine(runner, JSON.stringify({ type: "item.completed", item: { id: "msg-1", type: "agent_message", text: "done" } }));
  assert.equal(answer[1].message.content[0].text, "done");
  assert.deepEqual(driver.decodeLine(runner, '{"type":"error","message":"Reconnecting... 1/5"}'), [{ type: "pi_error", error: "Reconnecting... 1/5" }]);
  assert.deepEqual(driver.decodeLine(runner, '{"type":"error","message":"OAuth access token expired (401)"}').at(-1), { type: "harness_auth_failed", reason: "codex_oauth" });
  assert.deepEqual(driver.decodeLine(runner, '{"type":"turn.completed","usage":{"input_tokens":1}}'), [{ type: "agent_end", willRetry: false }, { type: "agent_settled" }]);

  driver.sendCommand(runner, launch.child, { id: "models", type: "get_available_models" });
  assert.deepEqual(line(launch.child.stdin), { type: "models", id: "models" });
  driver.decodeLine(runner, JSON.stringify({ type: "oyster.bridge.models", id: "models", models: [{ provider: "openai", id: "gpt-test" }] }));
  driver.sendCommand(runner, launch.child, { id: "model", type: "set_model", provider: "openai", modelId: "gpt-test" });
  driver.sendCommand(runner, launch.child, { id: "state", type: "get_state" });
  await tick();
  assert.equal(emitted.find((event) => event.id === "state").data.sessionId, "codex-thread");
  assert.deepEqual(emitted.find((event) => event.id === "state").data.model, { provider: "openai", id: "gpt-test" });
  assert.deepEqual(driver.sessionReference({ sessionId: "codex-thread" }), { backend: "codex", id: "codex-thread", storagePath: null });
});

test("Gemini CLI driver accumulates stream deltas and translates tool results", async () => {
  const { driver, runner, launch } = launchDriver(createGeminiDriver, { kind: "gemini" });
  const emitted = [];
  runner.driverEmit = (event) => emitted.push(event);
  driver.sendCommand(runner, launch.child, { id: "prompt", type: "prompt", message: "inspect" });
  await tick();
  const run = line(launch.child.stdin);
  assert.match(run.sessionId, /^[0-9a-f-]{36}$/);
  assert.equal(run.resume, false);

  const identity = driver.decodeLine(runner, JSON.stringify({ type: "init", session_id: run.sessionId, model: "gemini-test" }));
  assert.deepEqual(identity.map((event) => [event.type, event.command]), [["response", "get_state"]]);
  assert.deepEqual(identity[0].data.model, { provider: "google", id: "gemini-test" });
  const first = driver.decodeLine(runner, JSON.stringify({ type: "message", role: "assistant", content: "hel", delta: true, timestamp: "2026-01-01T00:00:00Z" }));
  const second = driver.decodeLine(runner, JSON.stringify({ type: "message", role: "assistant", content: "lo", delta: true }));
  assert.deepEqual(first.map((event) => event.type), ["message_start", "message_update"]);
  assert.equal(second[0].message.content[0].text, "hello");
  const tool = driver.decodeLine(runner, JSON.stringify({ type: "tool_use", tool_id: "read-1", tool_name: "read_file", parameters: { path: "a" } }));
  assert.deepEqual(tool.map((event) => event.type), ["message_end", "message_start", "message_end", "tool_execution_start"]);
  const result = driver.decodeLine(runner, JSON.stringify({ type: "tool_result", tool_id: "read-1", status: "success", output: "contents" }));
  assert.deepEqual(result.map((event) => event.type), ["tool_execution_end", "message_end"]);
  assert.deepEqual(driver.decodeLine(runner, JSON.stringify({ type: "result", status: "success" })), [{ type: "agent_end", willRetry: false }, { type: "agent_settled" }]);
  assert.deepEqual(driver.sessionReference({ sessionId: run.sessionId }), { backend: "gemini", id: run.sessionId, storagePath: null });
});

test("Amp driver handles its Claude-compatible stream and selects modes rather than arbitrary models", async () => {
  const { driver, runner, launch } = launchDriver(createAmpDriver, { kind: "amp" });
  const emitted = [];
  runner.driverEmit = (event) => emitted.push(event);
  driver.sendCommand(runner, launch.child, { id: "prompt", type: "prompt", message: "work" });
  await tick();
  assert.equal(line(launch.child.stdin).resume, false);
  const identity = driver.decodeLine(runner, JSON.stringify({ type: "system", subtype: "init", session_id: "T-amp" }));
  assert.deepEqual(identity.map((event) => [event.type, event.command]), [["response", "get_state"]]);
  const tool = driver.decodeLine(runner, JSON.stringify({ type: "assistant", message: { role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "read", input: { path: "a" } }] } }));
  assert.deepEqual(tool.map((event) => event.type), ["message_start", "message_end", "tool_execution_start"]);
  const toolResult = driver.decodeLine(runner, JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok", is_error: false }] } }));
  assert.deepEqual(toolResult.map((event) => event.type), ["tool_execution_end", "message_end"]);
  const answer = driver.decodeLine(runner, JSON.stringify({ type: "assistant", message: { role: "assistant", stop_reason: "end_turn", usage: { input_tokens: 2, output_tokens: 1 }, content: [{ type: "text", text: "done" }] } }));
  assert.deepEqual(answer.map((event) => event.type), ["message_start", "message_end", "agent_end", "agent_settled"]);
  driver.sendCommand(runner, launch.child, { id: "model", type: "set_model", provider: "amp", modelId: "anything" });
  await tick();
  assert.equal(emitted.find((event) => event.id === "model").success, false);
  driver.decodeLine(runner, JSON.stringify({ type: "oyster.bridge.models", id: "models", models: [{ provider: "amp", id: "high" }] }));
  driver.sendCommand(runner, launch.child, { id: "mode", type: "set_model", provider: "amp", modelId: "high" });
  driver.sendCommand(runner, launch.child, { id: "next", type: "prompt", message: "continue" });
  await tick();
  assert.equal(emitted.find((event) => event.id === "mode").success, true);
  assert.equal(line(launch.child.stdin).model, "high");
  assert.deepEqual(driver.sessionReference({ sessionId: "T-amp" }), { backend: "amp", id: "T-amp", storagePath: null });
});

test("headless bridge health probes produce a native stdout round trip and exits settle incomplete turns", () => {
  const { driver, runner, launch } = launchDriver(createCodexDriver, { kind: "codex" });
  driver.sendCommand(runner, launch.child, driver.healthCommand("health"));
  assert.deepEqual(line(launch.child.stdin), { type: "health", id: "health" });
  assert.deepEqual(driver.decodeLine(runner, '{"type":"oyster.bridge.pong","id":"health"}'), []);
  driver.decodeLine(runner, '{"type":"oyster.bridge.turn_start"}');
  assert.deepEqual(driver.decodeLine(runner, '{"type":"oyster.bridge.turn_exit","code":1,"signal":null,"stderr":"auth failed"}').map((event) => event.type), ["pi_error", "agent_end", "agent_settled"]);
});
