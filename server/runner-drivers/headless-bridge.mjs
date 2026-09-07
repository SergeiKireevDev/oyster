#!/usr/bin/env node
import { spawn } from "node:child_process";
import { CODEX_OPENROUTER_ARGS } from "../openrouter-routing.mjs";
import { discoverCodexModels } from "./codex.mjs";
import { discoverGeminiModels } from "./gemini.mjs";
import { discoverAntigravityModels } from "./antigravity.mjs";
import { ampModels } from "./amp.mjs";
import { createAmpOAuthCredentialSink } from "../amp-oauth-credential-sink.mjs";
import {
  chmodSync, closeSync, constants, fstatSync, mkdtempSync, openSync,
  readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createCodexOAuthCredentialSink } from "../codex-oauth-credential-sink.mjs";

function fail(message) {
  process.stderr.write(`[oyster bridge] ${message}\n`);
  process.exit(2);
}

let config;
try { config = JSON.parse(process.env.OYSTER_HEADLESS_BRIDGE_CONFIG ?? ""); }
catch { fail("invalid OYSTER_HEADLESS_BRIDGE_CONFIG"); }
if (!config || !["codex", "gemini", "amp", "antigravity"].includes(config.kind) || typeof config.bin !== "string" || !config.bin) {
  fail("bridge configuration requires a supported kind and executable");
}

let child = null;
let childKind = null;
let childMode = null;
let changingMode = false;
const discoveryAbort = new AbortController();
let discovery = null;
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

function readJsonCredential(path) {
  if (typeof path !== "string" || !path) return null;
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(descriptor).isFile()) return null;
    return JSON.parse(readFileSync(descriptor, "utf8"));
  } catch { return null; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function projectCodexOAuth(env) {
  const credential = readJsonCredential(config.piAuthPath)?.["openai-codex"];
  if (credential?.type !== "oauth" || typeof credential.access !== "string" || !credential.access || typeof config.codexHome !== "string") return;
  createCodexOAuthCredentialSink({ configDir: config.codexHome }).project(credential);
  env.CODEX_HOME = config.codexHome;
}

function geminiOAuthAccess() {
  const credential = readJsonCredential(config.geminiOAuthPath);
  return credential?.type === "oauth" && typeof credential.access === "string" && credential.access ? credential.access : null;
}

function codexArgs(run) {
  const common = [
    "--json",
    "--skip-git-repo-check",
    "-c", `mcp_servers.oyster.url=${tomlString(config.mcpUrl)}`,
    "-c", "mcp_servers.oyster.bearer_token_env_var=\"OYSTER_TOKEN\"",
    "-c", "mcp_servers.oyster.default_tools_approval_mode=\"auto\"",
    ...(config.systemPrompt ? ["-c", `developer_instructions=${tomlString(config.systemPrompt)}`] : []),
    ...(run.model ? ["--model", run.model] : config.provider === "openrouter" ? ["--model", "openai/gpt-5.4"] : []),
    ...(Array.isArray(config.extraArgs) ? config.extraArgs : []),
    ...(config.provider === "openrouter" ? CODEX_OPENROUTER_ARGS : []),
  ];
  if (run.resume && run.sessionId) {
    return ["exec", "resume", ...common, run.sessionId, run.prompt];
  }
  return ["exec", "--sandbox", config.sandbox ?? "workspace-write", ...common, run.prompt];
}

function ensureGeminiSettings(hasOAuth) {
  if (geminiSettingsDir) return join(geminiSettingsDir, "settings.json");
  geminiSettingsDir = mkdtempSync(join(tmpdir(), "oyster-gemini-"));
  chmodSync(geminiSettingsDir, 0o700);
  const path = join(geminiSettingsDir, "settings.json");
  writeFileSync(path, JSON.stringify({
    ...(hasOAuth ? { security: { auth: { selectedType: "oauth-personal" } } } : {}),
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

function antigravityArgs(run) {
  return [
    ...(Array.isArray(config.extraArgs) ? config.extraArgs : []),
    "--output-format", "stream-json", "--disable-slash-commands",
    ...(run.model ? ["--model", run.model] : []),
    ...(run.resume && run.sessionId ? ["--conversation", run.sessionId] : []),
    "--print", config.systemPrompt && !run.resume ? `${config.systemPrompt}\n\n${run.prompt}` : run.prompt,
  ];
}

function ampArgs(run) {
  const execution = [
    "--execute", "--stream-json", "--stream-json-input", "--stream-json-thinking", "--no-archive-after-execute",
    "--mcp-config", JSON.stringify({ oyster: {
      url: config.mcpUrl,
      headers: { Authorization: "Bearer ${OYSTER_TOKEN}" },
    } }),
    ...(run.model ? ["--mode", run.model] : []),
    ...(typeof config.ampSettingsPath === "string" ? ["--settings-file", config.ampSettingsPath] : []),
    ...(Array.isArray(config.extraArgs) ? config.extraArgs : []),
  ];
  return run.resume && run.sessionId
    ? ["threads", "continue", run.sessionId, ...execution]
    : execution;
}

function nativeEnvironment() {
  const env = { ...process.env };
  delete env.OYSTER_HEADLESS_BRIDGE_CONFIG;
  if (config.kind === "antigravity") env.OYSTER_MCP_URL = config.mcpUrl;
  if (config.kind === "codex" && config.provider !== "openrouter") projectCodexOAuth(env);
  if (config.kind === "gemini") {
    const access = geminiOAuthAccess();
    env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = ensureGeminiSettings(Boolean(access));
    if (access) {
      env.GOOGLE_GENAI_USE_GCA = "true";
      env.GOOGLE_CLOUD_ACCESS_TOKEN = access;
    }
  }
  return env;
}

async function listModels(message) {
  try {
    discovery ??= (async () => {
      const options = { bin: config.bin, cwd: config.cwd, env: nativeEnvironment(), signal: discoveryAbort.signal };
      if (config.kind === "codex") return discoverCodexModels({ ...options, provider: config.provider });
      if (config.kind === "gemini") return discoverGeminiModels(options);
      if (config.kind === "antigravity") return discoverAntigravityModels(options);
      const authenticated = options.env.AMP_API_KEY || (config.ampMarkerPath && createAmpOAuthCredentialSink({ bin: config.bin, settingsPath: config.ampSettingsPath, markerPath: config.ampMarkerPath }).status().configured);
      return authenticated ? ampModels() : [];
    })();
    output({ type: "oyster.bridge.models", id: message.id, models: await discovery });
  } catch (error) {
    output({ type: "oyster.bridge.models", id: message.id, error: error.message });
  } finally { discovery = null; }
}

function spawnChild(run) {
  childKind = config.kind;
  childMode = run.model;
  childStderr = "";
  const args = config.kind === "codex" ? codexArgs(run) : config.kind === "gemini" ? geminiArgs(run) : config.kind === "antigravity" ? antigravityArgs(run) : ampArgs(run);
  const env = nativeEnvironment();
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
    if (!changingMode) output({ type: "oyster.bridge.turn_exit", code, signal, ...(spawnError ? { error: spawnError.message } : {}), stderr: childStderr });
    changingMode = false;
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
  if (config.kind === "amp" && child?.stdin?.writable && childMode !== run.model) {
    queue.push(run);
    changingMode = true;
    const previous = child;
    previous.stdin.end();
    previous.kill("SIGTERM");
    const forceStop = setTimeout(() => previous.kill("SIGKILL"), 1000);
    forceStop.unref();
    previous.once("close", () => clearTimeout(forceStop));
    return;
  }
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
  else if (message?.type === "models") void listModels(message);
  else if (message?.type === "health") output({ type: "oyster.bridge.pong", id: message.id ?? null });
});
input.on("close", () => shutdown("SIGTERM"));

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  discoveryAbort.abort();
  queue.length = 0;
  if (child) child.kill(signal);
  else if (discovery) void discovery.catch(() => {}).finally(() => process.exit(0));
  else process.exit(0);
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("exit", () => {
  if (geminiSettingsDir) rmSync(geminiSettingsDir, { recursive: true, force: true });
});
