import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough, Writable } from "node:stream";
import { createAmpDriver } from "../server/runner-drivers/amp.mjs";
import { createAntigravityDriver } from "../server/runner-drivers/antigravity.mjs";
import { createClaudeCodeDriver } from "../server/runner-drivers/claude-code.mjs";
import { createCodexDriver } from "../server/runner-drivers/codex.mjs";
import { createCodexSessionStateReader } from "../server/runner-drivers/codex-session-model.mjs";
import { createGeminiDriver } from "../server/runner-drivers/gemini.mjs";
import { discoverCodexModels } from "../server/runner-drivers/native-models.mjs";

const BRIDGE = new URL("../server/runner-drivers/headless-bridge.mjs", import.meta.url).pathname;

function fakeProcess() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.exitCode = null; child.kill = () => {};
  return child;
}

function lines(stream) {
  return String(stream.read() ?? "").trim().split("\n").filter(Boolean).map((text) => JSON.parse(text));
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

function harness(factory, options = {}) {
  const launches = [];
  const driver = factory({ bin: "/opt/agent", spawnImpl(bin, args) { const child = fakeProcess(); launches.push({ bin, args, child }); return child; }, ...options });
  const runner = { id: "r1", sessionRef: null, sessionId: null, sessionName: null };
  const emitted = [];
  runner.driverEmit = (event) => emitted.push(event);
  const launch = () => { driver.launch({ runner, cwd: "/work", systemPrompt: "" }); return launches.at(-1); };
  const first = launch();
  const send = async (command, child = first.child) => {
    assert.equal(driver.sendCommand(runner, child, command), true);
    await tick();
    return emitted.find((event) => event.id === command.id);
  };
  return { driver, runner, emitted, launch, child: first.child, send, decode: (record) => driver.decodeLine(runner, JSON.stringify(record)) };
}

const CLAUDE_MODELS = [
  { value: "default", resolvedModel: "claude-sonnet-5-5", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
  { value: "claude-sonnet-4-6", resolvedModel: "claude-sonnet-4-6", supportsEffort: true, supportedEffortLevels: ["max", "low", "medium", "high"] },
  { value: "claude-haiku-4-5-20251001", resolvedModel: "claude-haiku-4-5-20251001" },
];
const claudeSuccess = (requestId, response) => ({ type: "control_response", response: { subtype: "success", request_id: requestId, ...(response ? { response } : {}) } });

test("Claude Code learns its effective effort at startup and lists the levels of the current model", async () => {
  const h = harness(createClaudeCodeDriver);
  await h.send({ id: "s", type: "get_state" });
  assert.deepEqual(lines(h.child.stdin).map((r) => r.request.subtype), ["get_settings"]);
  const probed = h.decode(claudeSuccess("oyster-settings-s", { applied: { model: "claude-sonnet-5-5[1m]", effort: "medium" } }));
  assert.deepEqual(probed.map((e) => [e.id, e.data.thinkingLevel, e.data.model.id]), [["_driver-claude-settings", "medium", "claude-sonnet-5-5[1m]"]]);
  await h.send({ id: "s2", type: "get_state" });
  assert.deepEqual(lines(h.child.stdin), [], "settings are probed once per process");

  await h.send({ id: "lv", type: "get_available_thinking_levels" });
  assert.deepEqual(lines(h.child.stdin), [{ type: "control_request", request_id: "oyster-levels-lv", request: { subtype: "list_models" } }]);
  assert.deepEqual(h.decode(claudeSuccess("oyster-levels-lv", { models: CLAUDE_MODELS })), [{
    type: "response", id: "lv", command: "get_available_thinking_levels", success: true,
    data: { levels: ["low", "medium", "high", "xhigh", "max"], current: "medium" },
  }]);

  // Levels follow the selected model, in canonical order; models without effort report none.
  h.runner.driverRuntime.model = "claude-sonnet-4-6";
  await h.send({ id: "lv2", type: "get_available_thinking_levels" });
  assert.deepEqual(h.decode(claudeSuccess("oyster-levels-lv2", { models: CLAUDE_MODELS }))[0].data.levels, ["low", "medium", "high", "max"]);
  h.runner.driverRuntime.model = "claude-haiku-4-5-20251001";
  await h.send({ id: "lv3", type: "get_available_thinking_levels" });
  const none = h.decode(claudeSuccess("oyster-levels-lv3", { models: CLAUDE_MODELS }))[0].data;
  assert.deepEqual(none.levels, []);
  assert.match(none.hint, /effort/);
  // A failed catalog read still offers the generic levels for an unlisted model.
  h.runner.driverRuntime.model = "custom-model";
  await h.send({ id: "lv4", type: "get_available_thinking_levels" });
  const fallback = h.decode({ type: "control_response", response: { subtype: "error", request_id: "oyster-levels-lv4", error: "nope" } });
  assert.deepEqual([fallback[0].success, fallback[0].data.levels.length], [true, 5]);
});

test("Claude Code reads its settings before answering a levels request on a fresh process", () => {
  const h = harness(createClaudeCodeDriver);
  h.driver.sendCommand(h.runner, h.child, { id: "lv", type: "get_available_thinking_levels" });
  assert.deepEqual(lines(h.child.stdin).map((r) => [r.request_id, r.request.subtype]), [["oyster-settings-lv", "get_settings"], ["oyster-levels-lv", "list_models"]]);
  h.decode(claudeSuccess("oyster-settings-lv", { applied: { model: "claude-sonnet-4-6", effort: "high" } }));
  assert.deepEqual(h.decode(claudeSuccess("oyster-levels-lv", { models: CLAUDE_MODELS }))[0].data, { levels: ["low", "medium", "high", "max"], current: "high" });
});

test("Claude Code applies a thinking level to the live session, confirms it, and keeps it across relaunches", async () => {
  const h = harness(createClaudeCodeDriver, { extraArgs: ["--effort", "low"] });
  assert.equal(h.runner.driverRuntime.selectedEffort, undefined);
  h.runner.driverRuntime.settingsProbedChild = h.child;

  assert.equal(h.driver.sendCommand(h.runner, h.child, { id: "t1", type: "set_thinking_level", level: "high" }), true);
  assert.deepEqual(lines(h.child.stdin), [
    { type: "control_request", request_id: "oyster-effort-t1", request: { subtype: "apply_flag_settings", settings: { effortLevel: "high" } } },
    { type: "control_request", request_id: "oyster-settings-t1", request: { subtype: "get_settings" } },
  ]);
  assert.deepEqual(h.decode(claudeSuccess("oyster-effort-t1")), [], "the answer waits for the confirming settings read");
  const confirmed = h.decode(claudeSuccess("oyster-settings-t1", { applied: { model: "claude-sonnet-5-5", effort: "high" } }));
  assert.deepEqual(confirmed[0], { type: "response", id: "t1", command: "set_thinking_level", success: true, data: { level: "high" } });
  assert.equal(confirmed[1].data.thinkingLevel, "high");
  const relaunched = h.launch();
  assert.deepEqual(relaunched.args.slice(-4), ["--effort", "low", "--effort", "high"], "the selection follows and overrides configured arguments");

  // The model clamps the request: report what Claude Code really uses.
  h.driver.sendCommand(h.runner, h.child, { id: "t2", type: "set_thinking_level", level: "xhigh" });
  h.decode(claudeSuccess("oyster-effort-t2"));
  const clamped = h.decode(claudeSuccess("oyster-settings-t2", { applied: { model: "claude-sonnet-5-5", effort: "high" } }));
  assert.equal(clamped.length, 1);
  assert.equal(clamped[0].success, false);
  assert.match(clamped[0].error, /kept thinking level high.*does not support xhigh/);
  assert.equal(h.runner.driverRuntime.selectedEffort, "high");

  // A rejected apply fails once; its paired settings read stays silent.
  h.driver.sendCommand(h.runner, h.child, { id: "t3", type: "set_thinking_level", level: "max" });
  const rejected = h.decode({ type: "control_response", response: { subtype: "error", request_id: "oyster-effort-t3", error: "unsupported" } });
  assert.deepEqual(rejected, [{ type: "response", id: "t3", command: "set_thinking_level", success: false, error: "unsupported" }]);
  assert.deepEqual(h.decode(claudeSuccess("oyster-settings-t3", { applied: { model: "claude-sonnet-5-5", effort: "high" } })), []);

  // Older Claude Code without get_settings: an accepted apply is trusted.
  h.driver.sendCommand(h.runner, h.child, { id: "t4", type: "set_thinking_level", level: "low" });
  h.decode(claudeSuccess("oyster-effort-t4"));
  const trusted = h.decode({ type: "control_response", response: { subtype: "error", request_id: "oyster-settings-t4", error: "unknown subtype" } });
  assert.deepEqual(trusted.map((e) => [e.command, e.success]), [["set_thinking_level", true], ["get_state", true]]);
  assert.equal(trusted[1].data.thinkingLevel, "low");

  lines(h.child.stdin);
  const invalid = await h.send({ id: "t5", type: "set_thinking_level", level: "ultra; rm" });
  assert.equal(invalid.success, false);
  assert.deepEqual(lines(h.child.stdin), [], "an unknown level never reaches Claude Code");
});

const CODEX_MODELS = [
  { provider: "openai", id: "gpt-sol", thinkingLevels: ["low", "medium", "high", "xhigh"], defaultThinkingLevel: "low", isDefault: true },
  { provider: "openai", id: "gpt-luna", thinkingLevels: ["low", "medium"], defaultThinkingLevel: "medium" },
];

test("Codex lists per-model reasoning efforts, sends the selection with each turn, and resets it on an incompatible model", async () => {
  const h = harness(createCodexDriver);
  assert.equal((await h.send({ id: "s0", type: "get_state" })).data.thinkingLevel, null);

  // The first request loads the native catalog through the bridge.
  assert.equal(h.driver.sendCommand(h.runner, h.child, { id: "lv", type: "get_available_thinking_levels" }), true);
  assert.deepEqual(lines(h.child.stdin), [{ type: "models", id: "lv" }]);
  assert.deepEqual(h.decode({ type: "oyster.bridge.models", id: "lv", models: CODEX_MODELS }), [{
    type: "response", id: "lv", command: "get_available_thinking_levels", success: true,
    data: { levels: ["low", "medium", "high", "xhigh"], current: "low", defaultLevel: "low" },
  }]);
  assert.equal((await h.send({ id: "s1", type: "get_state" })).data.thinkingLevel, "low", "the default model's default effort is shown");

  assert.equal((await h.send({ id: "bad", type: "set_thinking_level", level: "ultra" })).success, false);
  assert.deepEqual((await h.send({ id: "set", type: "set_thinking_level", level: "xhigh" })).data, { level: "xhigh" });
  assert.equal((await h.send({ id: "s2", type: "get_state" })).data.thinkingLevel, "xhigh");
  await h.send({ id: "p", type: "prompt", message: "go" });
  assert.deepEqual(lines(h.child.stdin), [{ type: "run", prompt: "go", sessionId: null, resume: false, steer: false, model: null, effort: "xhigh" }]);
  h.decode({ type: "oyster.bridge.turn_start" });
  h.decode({ type: "turn.completed" });

  await h.send({ id: "m", type: "set_model", provider: "openai", modelId: "gpt-luna" });
  const levels = await h.send({ id: "lv2", type: "get_available_thinking_levels" });
  assert.deepEqual(levels.data, { levels: ["low", "medium"], current: "medium", defaultLevel: "medium" });
  await h.send({ id: "p2", type: "prompt", message: "again" });
  assert.equal("effort" in lines(h.child.stdin)[0], false, "an unsupported selection falls back to the model default");
});

test("Codex reflects the effort recorded by the native session and falls back when the catalog is unavailable", async () => {
  const h = harness(createCodexDriver);
  const changed = h.decode({ type: "oyster.bridge.session_model", model: "gpt-custom", effort: "high" });
  assert.deepEqual(changed.map((e) => [e.command, e.data.thinkingLevel]), [["get_state", "high"]]);
  assert.deepEqual(h.decode({ type: "oyster.bridge.session_model", model: "gpt-custom", effort: "high" }), []);
  assert.equal(h.decode({ type: "oyster.bridge.session_model", model: "gpt-custom", effort: null })[0].data.thinkingLevel, null);

  h.driver.sendCommand(h.runner, h.child, { id: "lv", type: "get_available_thinking_levels" });
  const fallback = h.decode({ type: "oyster.bridge.models", id: "lv", error: "discovery timed out" });
  assert.deepEqual(fallback, [{ type: "response", id: "lv", command: "get_available_thinking_levels", success: true, data: { levels: ["low", "medium", "high"], current: null } }]);
  assert.equal((await h.send({ id: "set", type: "set_thinking_level", level: "xhigh" })).success, true, "an undescribed model accepts any known Codex effort");
  assert.equal((await h.send({ id: "bad", type: "set_thinking_level", level: "$(x)" })).success, false);
});

test("Antigravity offers its fixed efforts; Amp and Gemini explain why they have none", async () => {
  const agy = harness(createAntigravityDriver);
  assert.deepEqual((await agy.send({ id: "lv", type: "get_available_thinking_levels" })).data, { levels: ["low", "medium", "high"], current: null });
  assert.equal((await agy.send({ id: "set", type: "set_thinking_level", level: "high" })).success, true);
  assert.equal((await agy.send({ id: "s", type: "get_state" })).data.thinkingLevel, "high");
  await agy.send({ id: "p", type: "prompt", message: "go" });
  assert.equal(lines(agy.child.stdin)[0].effort, "high");

  for (const [factory, pattern] of [[createAmpDriver, /mode picker/], [createGeminiDriver, /does not expose/]]) {
    const h = harness(factory);
    const listed = (await h.send({ id: "lv", type: "get_available_thinking_levels" })).data;
    assert.deepEqual(listed.levels, []);
    assert.match(listed.hint, pattern);
    const refused = await h.send({ id: "set", type: "set_thinking_level", level: "high" });
    assert.equal(refused.success, false);
    assert.match(refused.error, pattern);
    assert.equal((await h.send({ id: "s", type: "get_state" })).data.thinkingLevel, null);
  }
});

async function bridgeArgv(t, kind, run, extraArgs = []) {
  const directory = mkdtempSync(join(tmpdir(), "oyster-effort-bridge-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, "agent.mjs");
  writeFileSync(bin, `#!${process.execPath}\nconsole.log(JSON.stringify({ type: "fake.argv", argv: process.argv.slice(2) }));\n`, { mode: 0o700 });
  const child = spawn(process.execPath, [BRIDGE], {
    cwd: directory, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CODEX_HOME: directory, OYSTER_TOKEN: "secret", OYSTER_HEADLESS_BRIDGE_CONFIG: JSON.stringify({ kind, bin, cwd: directory, extraArgs, mcpUrl: "http://127.0.0.1:8080/mcp?session=s" }) },
  });
  t.after(async () => { if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "close"); } });
  const found = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("bridge timeout")), 5000);
    createInterface({ input: child.stdout }).on("line", (text) => {
      let record; try { record = JSON.parse(text); } catch { return; }
      if (record.type === "fake.argv") { clearTimeout(timer); resolve(record.argv); }
    });
  });
  child.stdin.write(`${JSON.stringify({ type: "run", ...run })}\n`);
  return found;
}

test("the bridge passes the selected effort to Codex and Antigravity and drops malformed values", async (t) => {
  const configured = ["-c", 'model_reasoning_effort="low"'];
  let argv = await bridgeArgv(t, "codex", { prompt: "go", effort: "xhigh" }, configured);
  assert.deepEqual(argv.filter((arg) => arg.startsWith("model_reasoning_effort=")), ['model_reasoning_effort="low"', 'model_reasoning_effort="xhigh"'], "the selection follows a configured default so it wins");
  assert.equal(argv.at(-1), "go");
  argv = await bridgeArgv(t, "codex", { prompt: "go", sessionId: "thread-1", resume: true, effort: "high" });
  assert.deepEqual(argv.slice(0, 2), ["exec", "resume"]);
  assert.ok(argv.includes('model_reasoning_effort="high"'));
  argv = await bridgeArgv(t, "codex", { prompt: "go" });
  assert.equal(argv.some((arg) => arg.includes("model_reasoning_effort")), false);
  argv = await bridgeArgv(t, "codex", { prompt: "go", effort: 'high" --oops' });
  assert.equal(argv.some((arg) => arg.includes("model_reasoning_effort") || arg.includes("oops")), false);
  argv = await bridgeArgv(t, "antigravity", { prompt: "go", model: "m", effort: "medium" });
  assert.deepEqual(argv, ["--output-format", "stream-json", "--disable-slash-commands", "--model", "m", "--effort", "medium", "--print", "go"]);
});

test("Codex session state reader tracks the effort of the latest turn", (t) => {
  const home = mkdtempSync(join(tmpdir(), "codex-effort-test-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, "sessions", "2026", "11", "22");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "rollout-date-thread-1.jsonl");
  writeFileSync(path, '{"type":"turn_context","payload":{"model":"gpt-sol","effort":"high"}}\n');
  const read = createCodexSessionStateReader(home, "thread-1");
  assert.deepEqual(read(), { model: { provider: "openai", id: "gpt-sol" }, effort: "high" });
  appendFileSync(path, '{"type":"event_msg","payload":{}}\n');
  assert.equal(read().effort, "high");
  appendFileSync(path, '{"type":"turn_context","payload":{"model":"gpt-sol"}}\n');
  assert.equal(read().effort, null, "a turn without an explicit effort ran at the model default");
});

test("Codex resumes a session on the effort its last turn recorded", (t) => {
  const home = mkdtempSync(join(tmpdir(), "codex-effort-resume-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, "sessions"), { recursive: true });
  writeFileSync(join(home, "sessions", "rollout-date-thread-9.jsonl"), '{"type":"turn_context","payload":{"model":"gpt-sol","effort":"xhigh"}}\n');
  const driver = createCodexDriver({ bin: "/opt/codex", spawnImpl: () => fakeProcess(), bridgeOptions: { codexHome: home } });
  const runner = { id: "r", sessionRef: { backend: "codex", id: "thread-9" }, sessionId: "thread-9", sessionName: null };
  driver.launch({ runner, cwd: "/work", systemPrompt: "" });
  assert.equal(runner.driverRuntime.model, "gpt-sol");
  assert.equal(runner.driverRuntime.thinkingLevel, "xhigh");
});

test("Codex model discovery carries each model's reasoning efforts and default", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.emit("close"); return true; };
  child.stdin = new Writable({ write(chunk, _encoding, done) {
    const request = JSON.parse(String(chunk));
    const result = request.method === "account/read" ? { account: {} } : request.method === "model/list" ? { data: [
      { model: "gpt-sol", displayName: "Sol", isDefault: true, defaultReasoningEffort: "low",
        supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }, { reasoningEffort: "high" }, {}] },
      { model: "gpt-plain" },
    ] } : {};
    if (request.id != null) queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`));
    done();
  } });
  assert.deepEqual(await discoverCodexModels({ bin: "/bin/codex", cwd: "/tmp", env: {}, spawnImpl: () => child, timeout: 500 }), [
    { provider: "openai", id: "gpt-sol", name: "Sol", thinkingLevels: ["low", "high"], defaultThinkingLevel: "low", isDefault: true },
    { provider: "openai", id: "gpt-plain", name: "gpt-plain" },
  ]);
});
