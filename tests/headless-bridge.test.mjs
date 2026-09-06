import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const BRIDGE = new URL("../server/runner-drivers/headless-bridge.mjs", import.meta.url).pathname;

function fakeAgent(directory) {
  const path = join(directory, "fake-agent.mjs");
  writeFileSync(path, `#!/usr/bin/env node
import { createInterface } from "node:readline";
console.log(JSON.stringify({ type: "fake.argv", argv: process.argv.slice(2), settings: process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH ?? null, codexHome: process.env.CODEX_HOME ?? null, googleAccess: process.env.GOOGLE_CLOUD_ACCESS_TOKEN ?? null }));
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

async function bridgeRun(t, kind, run, configOverrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "oyster-bridge-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = fakeAgent(directory);
  const config = {
    kind, bin, cwd: directory, extraArgs: ["--agent-extra"], systemPrompt: "policy",
    mcpUrl: "http://127.0.0.1:8080/mcp?session=s&workdir=%2Fw&runner=r",
    sandbox: "workspace-write", approvalMode: "auto_edit", ...configOverrides,
  };
  const child = spawn(process.execPath, [BRIDGE], {
    cwd: directory,
    env: { ...process.env, OYSTER_TOKEN: "secret", OYSTER_HEADLESS_BRIDGE_CONFIG: JSON.stringify(config) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await once(child, "close");
  });
  const records = [];
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => { try { records.push(JSON.parse(line)); } catch {} });
  child.stdin.write(`${JSON.stringify({ type: "run", ...run })}\n`);
  child.stdin.write(`${JSON.stringify({ type: "health", id: "probe" })}\n`);
  const expected = kind === "amp" ? 4 : 4;
  const deadline = Date.now() + 5000;
  while (records.length < expected && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
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

  const credentialRoot = mkdtempSync(join(tmpdir(), "oyster-codex-oauth-test-"));
  t.after(() => rmSync(credentialRoot, { recursive: true, force: true }));
  const piAuthPath = join(credentialRoot, "auth.json");
  const codexHome = join(credentialRoot, "codex");
  const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account-1" } })).toString("base64url");
  const access = `header.${payload}.signature`;
  writeFileSync(piAuthPath, JSON.stringify({ "openai-codex": { type: "oauth", access, refresh: "refresh-secret", expires: Date.now() + 60_000 } }));
  records = await bridgeRun(t, "codex", { prompt: "oauth", resume: false }, { piAuthPath, codexHome });
  const oauthInvocation = records.find((record) => record.type === "fake.argv");
  assert.equal(oauthInvocation.codexHome, codexHome);
  const projection = JSON.parse(readFileSync(join(codexHome, "auth.json"), "utf8"));
  assert.equal(projection.tokens.access_token, access);
  assert.equal(projection.tokens.account_id, "account-1");
  assert.equal(projection.tokens.refresh_token, "", "Codex cannot race Oyster for the rotating refresh token");

  records = await bridgeRun(t, "codex", { prompt: "continue", sessionId: "thread-1", resume: true });
  argv = records.find((record) => record.type === "fake.argv").argv;
  assert.deepEqual(argv.slice(0, 2), ["exec", "resume"]);
  assert.ok(argv.includes("thread-1"));
});

test("Gemini bridge creates a private MCP settings file and injects Oyster-managed Google OAuth", async (t) => {
  const credentialRoot = mkdtempSync(join(tmpdir(), "oyster-gemini-oauth-test-"));
  t.after(() => rmSync(credentialRoot, { recursive: true, force: true }));
  const geminiOAuthPath = join(credentialRoot, "oauth.json");
  writeFileSync(geminiOAuthPath, JSON.stringify({ type: "oauth", access: "google-access-secret", refresh: "refresh", expires: Date.now() + 60_000 }));
  const records = await bridgeRun(t, "gemini", { prompt: "inspect", sessionId: "00000000-0000-4000-8000-000000000001", resume: false, model: "gemini-test" }, { geminiOAuthPath });
  const invocation = records.find((record) => record.type === "fake.argv");
  assert.ok(invocation.argv.includes("--output-format"));
  assert.ok(invocation.argv.includes("stream-json"));
  assert.ok(invocation.argv.includes("--session-id"));
  assert.ok(invocation.argv.includes("policy\n\ninspect"));
  assert.match(invocation.settings, /oyster-gemini-.*settings\.json$/);
  assert.equal(invocation.googleAccess, "google-access-secret");
  assert.equal(JSON.parse(readFileSync(invocation.settings, "utf8")).security.auth.selectedType, "oauth-personal");
});

test("Amp bridge uses the browser-managed settings and environment-expanded MCP headers", async (t) => {
  const records = await bridgeRun(t, "amp", { prompt: "work", sessionId: null, resume: false, steer: false }, { ampSettingsPath: "/private/amp/settings.json" });
  const invocation = records.find((record) => record.type === "fake.argv");
  assert.ok(invocation.argv.includes("--stream-json-input"));
  assert.equal(invocation.argv[invocation.argv.indexOf("--settings-file") + 1], "/private/amp/settings.json");
  const config = JSON.parse(invocation.argv[invocation.argv.indexOf("--mcp-config") + 1]);
  assert.equal(config.oyster.headers.Authorization, "Bearer ${OYSTER_TOKEN}");
  const input = records.find((record) => record.type === "fake.stdin").message;
  assert.equal(input.steer, false);
  assert.equal(input.message.content[0].text, "policy\n\nwork");
});
