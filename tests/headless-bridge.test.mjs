import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const BRIDGE = new URL("../server/runner-drivers/headless-bridge.mjs", import.meta.url).pathname;

function fakeAgent(directory) {
  const path = join(directory, "fake-agent.mjs");
  writeFileSync(path, `#!/usr/bin/env node
import { createInterface } from "node:readline";
console.log(JSON.stringify({ type: "fake.argv", argv: process.argv.slice(2), settings: process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH ?? null }));
if (process.argv.includes("--stream-json-input")) {
  const input = createInterface({ input: process.stdin });
  input.once("line", (line) => {
    const message = JSON.parse(line);
    console.log(JSON.stringify({ type: "fake.stdin", message }));
  });
}
`, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

async function bridgeRun(t, kind, run) {
  const directory = mkdtempSync(join(tmpdir(), "oyster-bridge-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = fakeAgent(directory);
  const config = {
    kind, bin, cwd: directory, extraArgs: ["--agent-extra"], systemPrompt: "policy",
    mcpUrl: "http://127.0.0.1:8080/mcp?session=s&workdir=%2Fw&runner=r",
    sandbox: "workspace-write", approvalMode: "auto_edit",
  };
  const child = spawn(process.execPath, [BRIDGE], {
    cwd: directory,
    env: { ...process.env, OYSTER_TOKEN: "secret", OYSTER_HEADLESS_BRIDGE_CONFIG: JSON.stringify(config) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const records = [];
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => { try { records.push(JSON.parse(line)); } catch {} });
  child.stdin.write(`${JSON.stringify({ type: "run", ...run })}\n`);
  child.stdin.write(`${JSON.stringify({ type: "health", id: "probe" })}\n`);
  const expected = kind === "amp" ? 4 : 4;
  const deadline = Date.now() + 5000;
  while (records.length < expected && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  child.kill("SIGTERM");
  return records;
}

test("Codex bridge builds new and resumed exec commands without putting the Oyster token in argv", async (t) => {
  let records = await bridgeRun(t, "codex", { prompt: "do it", sessionId: null, resume: false, model: "gpt-test" });
  let argv = records.find((record) => record.type === "fake.argv").argv;
  assert.deepEqual(argv.slice(0, 3), ["exec", "--sandbox", "workspace-write"]);
  assert.ok(argv.includes("--json"));
  assert.ok(argv.includes("developer_instructions=\"policy\""));
  assert.ok(argv.includes("mcp_servers.oyster.bearer_token_env_var=\"OYSTER_TOKEN\""));
  assert.ok(argv.includes("gpt-test"));
  assert.equal(argv.some((arg) => arg.includes("secret")), false);
  assert.ok(records.some((record) => record.type === "oyster.bridge.pong" && record.id === "probe"));

  records = await bridgeRun(t, "codex", { prompt: "continue", sessionId: "thread-1", resume: true });
  argv = records.find((record) => record.type === "fake.argv").argv;
  assert.deepEqual(argv.slice(0, 2), ["exec", "resume"]);
  assert.ok(argv.includes("thread-1"));
});

test("Gemini bridge creates a private MCP settings file and passes headless session flags", async (t) => {
  const records = await bridgeRun(t, "gemini", { prompt: "inspect", sessionId: "00000000-0000-4000-8000-000000000001", resume: false, model: "gemini-test" });
  const invocation = records.find((record) => record.type === "fake.argv");
  assert.ok(invocation.argv.includes("--output-format"));
  assert.ok(invocation.argv.includes("stream-json"));
  assert.ok(invocation.argv.includes("--session-id"));
  assert.ok(invocation.argv.includes("policy\n\ninspect"));
  assert.match(invocation.settings, /oyster-gemini-.*settings\.json$/);
});

test("Amp bridge uses streaming JSON input and environment-expanded MCP headers", async (t) => {
  const records = await bridgeRun(t, "amp", { prompt: "work", sessionId: null, resume: false, steer: false });
  const invocation = records.find((record) => record.type === "fake.argv");
  assert.ok(invocation.argv.includes("--stream-json-input"));
  const config = JSON.parse(invocation.argv[invocation.argv.indexOf("--mcp-config") + 1]);
  assert.equal(config.oyster.headers.Authorization, "Bearer ${OYSTER_TOKEN}");
  const input = records.find((record) => record.type === "fake.stdin").message;
  assert.equal(input.steer, false);
  assert.equal(input.message.content[0].text, "policy\n\nwork");
});
