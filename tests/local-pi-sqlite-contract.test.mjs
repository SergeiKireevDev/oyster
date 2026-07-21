import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const LOCAL_PI = process.env.PI_SQLITE_TEST_BIN ?? fileURLToPath(new URL("../pi/packages/coding-agent/dist/cli.js", import.meta.url));
const SKIP = process.env.PI_SQLITE_CONTRACT_TEST === "skip";

async function startMockModel() {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    for await (const _chunk of req) { /* drain request */ }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl-sqlite-contract",
      object: "chat.completion.chunk",
      created: 0,
      model: "sqlite-contract",
      choices: [{ index: 0, delta: { role: "assistant", content: "persisted" }, finish_reason: null }],
    })}\n\n`);
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl-sqlite-contract",
      object: "chat.completion.chunk",
      created: 0,
      model: "sqlite-contract",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

function writeModelConfig(agentDir, baseUrl) {
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({
    providers: {
      mock: {
        baseUrl,
        api: "openai-completions",
        apiKey: "sqlite-contract-key",
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        models: [{
          id: "sqlite-contract",
          name: "SQLite Contract",
          reasoning: false,
          input: ["text"],
          contextWindow: 128000,
          maxTokens: 4096,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }],
      },
    },
  }));
}

function launchPi({ agentDir, cwd, continued = false }) {
  const args = [
    "--mode", "rpc", "--model", "mock/sqlite-contract", "--no-extensions", "--no-tools",
    ...(continued ? ["--continue"] : []),
  ];
  const proc = spawn(LOCAL_PI, args, {
    cwd,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PERSISTENT_STORE: "sqlite" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = [];
  const waiters = [];
  let stderr = "";
  proc.stderr.on("data", (chunk) => { stderr += chunk; });
  createInterface({ input: proc.stdout }).on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
    if (waiterIndex >= 0) waiters.splice(waiterIndex, 1)[0].resolve(message);
    else lines.push(message);
  });

  function next(predicate, timeout = 20_000) {
    const index = lines.findIndex(predicate);
    if (index >= 0) return Promise.resolve(lines.splice(index, 1)[0]);
    return new Promise((resolvePromise, reject) => {
      const waiter = { predicate, resolve: resolvePromise };
      waiters.push(waiter);
      const timer = setTimeout(() => {
        const waiterIndex = waiters.indexOf(waiter);
        if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
        reject(new Error(`timed out waiting for pi RPC output; stderr: ${stderr}`));
      }, timeout);
      waiter.resolve = (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      };
    });
  }

  let sequence = 0;
  async function rpc(type, fields = {}) {
    const id = `contract-${++sequence}`;
    proc.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`);
    const response = await next((message) => message.type === "response" && message.id === id, 30_000);
    assert.equal(response.success, true, response.error ?? stderr);
    return response.data;
  }

  async function stop() {
    if (proc.exitCode !== null) return;
    proc.kill("SIGTERM");
    await once(proc, "exit");
  }

  return {
    proc,
    rpc,
    waitForAgentEnd: () => next((message) => message.type === "agent_end", 30_000),
    stop,
  };
}

function findJsonl(path) {
  if (!existsSync(path)) return [];
  const found = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) found.push(...findJsonl(target));
    else if (entry.name.endsWith(".jsonl")) found.push(target);
  }
  return found;
}

test("configured local pi persists and restores RPC sessions through SQLite", {
  skip: SKIP ? "PI_SQLITE_CONTRACT_TEST=skip" : false,
  timeout: 60_000,
}, async (t) => {
  assert.equal(existsSync(LOCAL_PI), true,
    `local pi is required at ${LOCAL_PI}; build it or explicitly set PI_SQLITE_CONTRACT_TEST=skip`);
  const root = mkdtempSync(join(tmpdir(), "pi-ui-sqlite-contract-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const mock = await startMockModel();
  writeModelConfig(agentDir, mock.baseUrl);
  let pi = null;
  t.after(async () => {
    await pi?.stop();
    mock.server.close();
    await once(mock.server, "close");
    rmSync(root, { recursive: true, force: true });
  });

  pi = launchPi({ agentDir, cwd });
  await pi.rpc("prompt", { message: "Persist this deterministic turn" });
  await pi.waitForAgentEnd();
  const beforeStats = await pi.rpc("get_session_stats");
  const beforeEntries = await pi.rpc("get_entries");
  assert.ok(beforeEntries.entries.length >= 2);
  await pi.stop();

  const database = join(agentDir, "sessions.sqlite");
  assert.equal(existsSync(database), true);
  assert.ok(statSync(database).size > 0);
  assert.deepEqual(findJsonl(agentDir), []);
  const db = new DatabaseSync(database, { readOnly: true });
  const persistedSessions = db.prepare("SELECT id, cwd, active_leaf_id FROM sessions ORDER BY created_at").all();
  db.close();
  assert.deepEqual(persistedSessions.map((session) => ({ ...session })), [
    { id: beforeStats.sessionId, cwd, active_leaf_id: beforeEntries.leafId },
  ]);

  pi = launchPi({ agentDir, cwd, continued: true });
  const restoredStats = await pi.rpc("get_session_stats");
  const restoredEntries = await pi.rpc("get_entries");
  assert.equal(restoredStats.sessionId, beforeStats.sessionId);
  assert.equal(restoredEntries.leafId, beforeEntries.leafId);
  assert.deepEqual(
    restoredEntries.entries.map((entry) => entry.id),
    beforeEntries.entries.map((entry) => entry.id),
  );
  assert.deepEqual(findJsonl(agentDir), []);
});
