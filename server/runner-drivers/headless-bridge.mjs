#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

function fail(message) {
  process.stderr.write(`[oyster bridge] ${message}\n`);
  process.exit(2);
}

let config;
try { config = JSON.parse(process.env.OYSTER_HEADLESS_BRIDGE_CONFIG ?? ""); }
catch { fail("invalid OYSTER_HEADLESS_BRIDGE_CONFIG"); }
if (!config || !["codex", "gemini", "amp"].includes(config.kind) || typeof config.bin !== "string" || !config.bin) {
  fail("bridge configuration requires a supported kind and executable");
}

let child = null;
let childKind = null;
let childStderr = "";
let stopping = false;
const queue = [];
let geminiSettingsDir = null;

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function codexArgs(run) {
  const common = [
    "--json",
    "--skip-git-repo-check",
    "-c", `mcp_servers.oyster.url=${tomlString(config.mcpUrl)}`,
    "-c", "mcp_servers.oyster.bearer_token_env_var=\"OYSTER_TOKEN\"",
    "-c", "mcp_servers.oyster.default_tools_approval_mode=\"auto\"",
    ...(config.systemPrompt ? ["-c", `developer_instructions=${tomlString(config.systemPrompt)}`] : []),
    ...(run.model ? ["--model", run.model] : []),
    ...(Array.isArray(config.extraArgs) ? config.extraArgs : []),
  ];
  if (run.resume && run.sessionId) {
    return ["exec", "resume", ...common, run.sessionId, run.prompt];
  }
  return ["exec", "--sandbox", config.sandbox ?? "workspace-write", ...common, run.prompt];
}

function ensureGeminiSettings() {
  if (geminiSettingsDir) return join(geminiSettingsDir, "settings.json");
  geminiSettingsDir = mkdtempSync(join(tmpdir(), "oyster-gemini-"));
  chmodSync(geminiSettingsDir, 0o700);
  const path = join(geminiSettingsDir, "settings.json");
  writeFileSync(path, JSON.stringify({
    mcpServers: {
      oyster: {
        httpUrl: config.mcpUrl,
        headers: { Authorization: "Bearer ${OYSTER_TOKEN}" },
        trust: true,
      },
    },
  }), { mode: 0o600 });
  return path;
}

function geminiArgs(run) {
  return [
    ...(Array.isArray(config.extraArgs) ? config.extraArgs : []),
    "--output-format", "stream-json",
    "--approval-mode", config.approvalMode ?? "auto_edit",
    "--skip-trust",
    "--allowed-mcp-server-names", "oyster",
    ...(run.model ? ["--model", run.model] : []),
    ...(run.resume && run.sessionId ? ["--resume", run.sessionId] : ["--session-id", run.sessionId]),
    "--prompt", config.systemPrompt && !run.resume ? `${config.systemPrompt}\n\n${run.prompt}` : run.prompt,
  ];
}

function ampArgs(run) {
  const execution = [
    "--execute", "--stream-json", "--stream-json-input", "--stream-json-thinking", "--no-archive-after-execute",
    "--mcp-config", JSON.stringify({ oyster: {
      url: config.mcpUrl,
      headers: { Authorization: "Bearer ${OYSTER_TOKEN}" },
    } }),
    ...(Array.isArray(config.extraArgs) ? config.extraArgs : []),
  ];
  return run.resume && run.sessionId
    ? ["threads", "continue", run.sessionId, ...execution]
    : execution;
}

function spawnChild(run) {
  childKind = config.kind;
  childStderr = "";
  const args = config.kind === "codex" ? codexArgs(run) : config.kind === "gemini" ? geminiArgs(run) : ampArgs(run);
  const env = { ...process.env };
  delete env.OYSTER_HEADLESS_BRIDGE_CONFIG;
  if (config.kind === "gemini") env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = ensureGeminiSettings();
  output({ type: "oyster.bridge.turn_start" });
  child = spawn(config.bin, args, { cwd: config.cwd, stdio: [config.kind === "amp" ? "pipe" : "ignore", "pipe", "pipe"], env });
  const childOutput = createInterface({ input: child.stdout });
  childOutput.on("line", (line) => process.stdout.write(`${line}\n`));
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    childStderr = `${childStderr}${text}`.slice(-16_384);
    process.stderr.write(`[${config.kind}] ${text}`);
  });
  let spawnError = null;
  child.on("error", (error) => { spawnError = error; });
  // `close` follows drained stdout/stderr and also fires after spawn errors;
  // `exit` alone has neither guarantee.
  child.on("close", (code, signal) => {
    const wasAmp = childKind === "amp";
    child = null;
    childKind = null;
    output({ type: "oyster.bridge.turn_exit", code, signal, ...(spawnError ? { error: spawnError.message } : {}), stderr: childStderr });
    if (!stopping && (!wasAmp || queue.length)) runNext();
  });
  if (config.kind === "amp") {
    const prompt = config.systemPrompt && !run.resume ? `${config.systemPrompt}\n\n${run.prompt}` : run.prompt;
    child.stdin.write(`${JSON.stringify({ type: "user", steer: Boolean(run.steer), message: { role: "user", content: [{ type: "text", text: prompt }] } })}\n`);
  }
}

function runNext() {
  if (child || stopping || !queue.length) return;
  spawnChild(queue.shift());
}

function runPrompt(message) {
  const run = {
    prompt: String(message.prompt ?? ""),
    sessionId: typeof message.sessionId === "string" && message.sessionId ? message.sessionId : null,
    resume: message.resume === true,
    steer: message.steer === true,
    model: typeof message.model === "string" && message.model ? message.model : null,
  };
  if (config.kind === "amp" && child?.stdin?.writable) {
    output({ type: "oyster.bridge.turn_start" });
    const prompt = config.systemPrompt && !run.resume ? `${config.systemPrompt}\n\n${run.prompt}` : run.prompt;
    child.stdin.write(`${JSON.stringify({ type: "user", steer: run.steer, message: { role: "user", content: [{ type: "text", text: prompt }] } })}\n`);
    return;
  }
  queue.push(run);
  runNext();
}

function abortTurn() {
  queue.length = 0;
  if (child) child.kill("SIGINT");
}

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message?.type === "run") runPrompt(message);
  else if (message?.type === "abort") abortTurn();
  else if (message?.type === "health") output({ type: "oyster.bridge.pong", id: message.id ?? null });
});
input.on("close", () => shutdown("SIGTERM"));

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  queue.length = 0;
  if (child) child.kill(signal);
  else process.exit(0);
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("exit", () => {
  if (geminiSettingsDir) rmSync(geminiSettingsDir, { recursive: true, force: true });
});
