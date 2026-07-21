import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runSessionCatalogContract } from "./helpers/session-catalog-contract.mjs";
import { createSqliteSessionCatalog } from "../sessions/sqliteCatalog.mjs";

const LOCAL_PI = "/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js";
const SKIP_LOCAL = process.env.PI_SQLITE_CONTRACT_TEST === "skip";
const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

function schema(database) {
  database.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, cwd TEXT NOT NULL,
      parent_session_id TEXT, metadata TEXT, active_leaf_id TEXT, updated_at TEXT,
      first_message TEXT, all_messages_text TEXT) WITHOUT ROWID;
    CREATE TABLE session_entries (session_id TEXT NOT NULL, id TEXT NOT NULL, entry_seq INTEGER NOT NULL,
      parent_id TEXT, type TEXT NOT NULL, timestamp TEXT NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY (session_id, id));
    CREATE TABLE session_materialized (session_id TEXT PRIMARY KEY, payload TEXT NOT NULL) WITHOUT ROWID;
  `);
}

async function mockModel() {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") return response.writeHead(404).end();
    let body = "";
    for await (const chunk of request) body += chunk;
    const text = body.includes("fork prompt") ? "fork response" : "durable phrase";
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write(`data: ${JSON.stringify({ id: "catalog", object: "chat.completion.chunk", created: 0, model: "sqlite-catalog", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: "catalog", object: "chat.completion.chunk", created: 0, model: "sqlite-catalog", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

function runPi(agentDir, cwd, args) {
  return new Promise((resolvePromise, reject) => {
    const process = spawn(LOCAL_PI, ["--model", "mock/sqlite-catalog", "--no-extensions", "--no-tools", ...args], {
      cwd,
      env: { ...globalThis.process.env, PI_CODING_AGENT_DIR: agentDir, PERSISTENT_STORE: "sqlite" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    process.stderr.on("data", (chunk) => { stderr += chunk; });
    process.on("error", reject);
    process.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`pi exited ${code}: ${stderr}`)));
  });
}

let processFixture;
async function createProcessFixture() {
  if (processFixture) return processFixture;
  assert.equal(existsSync(LOCAL_PI), true, `local pi missing at ${LOCAL_PI}`);
  const root = mkdtempSync(join(tmpdir(), "pi-sqlite-catalog-process-"));
  roots.push(root);
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  mkdirSync(agentDir); mkdirSync(cwd);
  const mock = await mockModel();
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { mock: {
    baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "test", compat: { supportsDeveloperRole: false },
    models: [{ id: "sqlite-catalog", name: "SQLite Catalog", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }));
  try {
    await runPi(agentDir, cwd, ["-p", "root prompt"]);
    const sourceCatalog = createSqliteSessionCatalog({ databasePath: join(agentDir, "sessions.sqlite") });
    const rootId = sourceCatalog.list({ cwd })[0].id;
    await runPi(agentDir, cwd, ["--fork", rootId, "-p", "fork prompt"]);
    const copiedDatabase = join(root, "catalog-copy.sqlite");
    copyFileSync(join(agentDir, "sessions.sqlite"), copiedDatabase);
    const catalog = createSqliteSessionCatalog({ databasePath: copiedDatabase });
    processFixture = { catalog, cwd, rootId, rootIdentity: rootId, databasePath: copiedDatabase };
    return processFixture;
  } finally {
    mock.server.close();
    await once(mock.server, "close");
  }
}

if (SKIP_LOCAL) {
  test("SQLite process catalog contract", { skip: "PI_SQLITE_CONTRACT_TEST=skip" }, () => {});
} else {
  runSessionCatalogContract("SQLite", createProcessFixture);
  test("SQLite catalog preserves process-created parent session IDs", async () => {
    const { catalog, rootId } = await createProcessFixture();
    assert.equal(catalog.list().find((session) => session.id !== rootId).parentSessionId, rootId);
  });
}

test("SQLite catalog skips malformed entry payloads and closes every read handle", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-sqlite-catalog-malformed-"));
  roots.push(root);
  const path = join(root, "sessions.sqlite");
  const writer = new DatabaseSync(path);
  schema(writer);
  writer.prepare("INSERT INTO sessions VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)").run("broken", "2026-01-01", "/work", "good", "2026-01-01", "root prompt", "durable phrase");
  writer.prepare("INSERT INTO session_materialized VALUES (?, ?)").run("broken", "not-json");
  writer.prepare("INSERT INTO session_entries VALUES (?, ?, ?, NULL, ?, ?, ?)").run("broken", "bad", 1, "message", "t1", "not-json");
  writer.prepare("INSERT INTO session_entries VALUES (?, ?, ?, NULL, ?, ?, ?)").run("broken", "good", 2, "message", "t2", JSON.stringify({ message: { role: "assistant", content: "durable phrase" } }));
  writer.close();

  let closes = 0;
  const catalog = createSqliteSessionCatalog({
    databasePath: path,
    databaseFactory(databasePath) {
      const database = new DatabaseSync(databasePath, { readOnly: true });
      return new Proxy(database, { get(target, property) {
        if (property === "close") return () => { closes++; target.close(); };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    },
  });
  assert.equal(catalog.list()[0].name, null);
  assert.deepEqual(catalog.tree("broken").nodes.map((node) => node.id), ["good"]);
  assert.deepEqual(catalog.messages("broken").messages.map((message) => message.content), ["durable phrase"]);
  assert.equal(closes, 3);
});

test("SQLite catalog reads committed WAL updates while another handle remains open", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-sqlite-catalog-wal-"));
  roots.push(root);
  const path = join(root, "sessions.sqlite");
  const writer = new DatabaseSync(path);
  writer.exec("PRAGMA journal_mode=WAL");
  schema(writer);
  const insert = writer.prepare("INSERT INTO sessions VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?)");
  insert.run("one", "2026-01-01", "/work", "2026-01-01", "one", "one");
  const catalog = createSqliteSessionCatalog({ databasePath: path });
  assert.deepEqual(catalog.list().map((session) => session.id), ["one"]);
  insert.run("two", "2026-01-02", "/work", "2026-01-02", "two", "two");
  assert.deepEqual(catalog.list().map((session) => session.id), ["two", "one"]);
  writer.close();
});
