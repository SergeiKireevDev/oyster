import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createAntigravityDriver, discoverAntigravityModels } from "../server/runner-drivers/antigravity.mjs";
import { createConfiguredRunnerDrivers } from "../server/runner-drivers/configured.mjs";

const decode = (driver, runner, value) => driver.decodeLine(runner, JSON.stringify(value));

test("Antigravity decodes native identity, deltas, tools, failures, and resume without duplicated response", () => {
  const driver = createAntigravityDriver({ bin: "/opt/agy" });
  const runner = { id: "runner" };
  const child = { stdin: new PassThrough() };
  driver.sendCommand(runner, child, { type: "prompt", message: "hello" });
  assert.equal(JSON.parse(String(child.stdin.read())).resume, false);
  assert.equal(decode(driver, runner, { event: "init", conversation_id: "conversation", init: { model: "native-model" } })[0].data.sessionId, "conversation");
  for (const text of ["hel", "lo"]) decode(driver, runner, { event: "step_update", step_update: { step_type: "agent_response", text_delta: text } });
  const tool = { event: "step_update", step_update: { conversation_id: "conversation", step_index: 2, step_type: "tool", state: "DONE", tool_name: "run_command", tool_info: { parameters: { CommandLine: "false" }, error: { message: "failed" } } } };
  const events = decode(driver, runner, tool);
  assert.equal(events.filter(e => e.type === "tool_execution_start").length, 1);
  assert.equal(events.find(e => e.type === "tool_execution_end").isError, true);
  assert.deepEqual(decode(driver, runner, tool), []);
  decode(driver, runner, { event: "result", result: { status: "SUCCESS", response: "hello" } });
  assert.equal(runner.driverRuntime.messages.filter(m => m.role === "assistant" && m.content[0].type === "text").length, 1);
  assert.equal(runner.driverRuntime.messages[1].provider, "antigravity");
  driver.sendCommand(runner, child, { type: "prompt", message: "again" });
  assert.equal(JSON.parse(String(child.stdin.read())).sessionId, "conversation");
  decode(driver, runner, { event: "init", conversation_id: "conversation", init: {} });
  const failed = decode(driver, runner, { event: "result", result: { status: "WAITING", error: "approval needed" } });
  assert.equal(failed.find(e => e.type === "pi_error").error, "approval needed");
  assert.ok(failed.some(e => e.type === "agent_settled"));
  assert.equal(driver.sessionReference({ sessionId: "conversation" }).backend, "antigravity");
});

test("a completed native process exiting cannot settle a newly queued Antigravity turn", () => {
  const driver = createAntigravityDriver({ bin: "/opt/agy" });
  const runner = { id: "runner" };
  const child = { stdin: new PassThrough() };
  driver.sendCommand(runner, child, { type: "prompt", message: "one" });
  decode(driver, runner, { type: "oyster.bridge.turn_start" });
  decode(driver, runner, { event: "init", conversation_id: "one" });
  decode(driver, runner, { event: "result", result: { status: "SUCCESS", response: "one" } });
  driver.sendCommand(runner, child, { type: "prompt", message: "two" });
  assert.deepEqual(decode(driver, runner, { type: "oyster.bridge.turn_exit", code: 0 }), []);
  assert.equal(runner.driverRuntime.streaming, true);
  decode(driver, runner, { type: "oyster.bridge.turn_start" });
  const failed = decode(driver, runner, { type: "oyster.bridge.turn_exit", code: 1, stderr: "startup failed" });
  assert.equal(failed[0].error, "startup failed");
  assert.equal(runner.driverRuntime.streaming, false);
});

test("Antigravity is opt-in in the configured registry", () => {
  const config = { PI_BIN: "/opt/pi", PI_EXTRA_ARGS: [], ANTIGRAVITY_BIN: "/opt/agy", ANTIGRAVITY_ARGS: [] };
  const registry = createConfiguredRunnerDrivers({ config, piProcesses: { launch() {} } });
  assert.deepEqual(registry.list().at(-1), { id: "antigravity", label: "Antigravity CLI" });
});

test("Antigravity bridge uses documented flags, inherited MCP identity, and native model discovery", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-agy-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "agy");
  writeFileSync(bin, `#!${process.execPath}\nif(process.argv[2]==='models'){console.log('model-one\\tModel One');process.exit(0)}\nconsole.log(JSON.stringify({event:'probe',args:process.argv.slice(2),url:process.env.OYSTER_MCP_URL,token:process.env.OYSTER_TOKEN}));\n`, { mode: 0o700 });
  assert.deepEqual(await discoverAntigravityModels({ bin, cwd: root, env: process.env }), [{ provider: "antigravity", id: "model-one", name: "Model One" }]);
  const child = spawn(process.execPath, [new URL("../server/runner-drivers/headless-bridge.mjs", import.meta.url).pathname], {
    env: { ...process.env, OYSTER_TOKEN: "secret", OYSTER_HEADLESS_BRIDGE_CONFIG: JSON.stringify({ kind: "antigravity", bin, cwd: root, systemPrompt: "policy", mcpUrl: "http://127.0.0.1:8080/mcp?session=one" }) }, stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  let output = "";
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("bridge timeout")), 5000);
    child.stdout.on("data", (b) => { output += b; if (output.includes('"oyster.bridge.turn_exit"')) { clearTimeout(timer); resolve(); } });
    child.on("error", reject);
  });
  child.stdin.write(JSON.stringify({ type: "run", prompt: "hello", resume: true, sessionId: "conversation", model: "model-one" }) + "\n");
  await done;
  const probe = output.trim().split("\n").map(JSON.parse).find(e => e.event === "probe");
  assert.deepEqual(probe.args, ["--output-format", "stream-json", "--disable-slash-commands", "--model", "model-one", "--conversation", "conversation", "--print", "hello"]);
  assert.equal(probe.url, "http://127.0.0.1:8080/mcp?session=one");
  assert.equal(probe.token, "secret");
  assert.ok(!probe.args.includes("--dangerously-skip-permissions"));
  child.stdin.end();
});

test("MCP setup is idempotent, preserves other servers, and refuses collisions", (t) => {
  const home = mkdtempSync(join(tmpdir(), "oyster-agy-config-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const script = new URL("../scripts/configure-antigravity-mcp.mjs", import.meta.url).pathname;
  const run = () => execFileSync(process.execPath, [script], { env: { ...process.env, HOME: home }, stdio: "pipe" });
  run(); run();
  const path = join(home, ".gemini/config/mcp_config.json");
  writeFileSync(path, ""); // AGY itself can initialize an empty config file.
  run();
  const config = JSON.parse(readFileSync(path));
  assert.deepEqual(Object.keys(config.mcpServers.oyster), ["command", "args"]);
  config.mcpServers.other = { command: "other" };writeFileSync(path, JSON.stringify(config));run();
  assert.deepEqual(JSON.parse(readFileSync(path)).mcpServers.other, { command: "other" });
  config.mcpServers.oyster = { command: "existing" };writeFileSync(path, JSON.stringify(config));
  assert.throws(run, /refusing to overwrite/);
  assert.deepEqual(JSON.parse(readFileSync(path)).mcpServers.oyster, { command: "existing" });
});
