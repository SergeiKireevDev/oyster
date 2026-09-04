import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { runSessionCatalogContract } from "./helpers/session-catalog-contract.mjs";
import { createSqliteSessionCatalog } from "../server/sessions/sqliteCatalog.mjs";
import { transcriptMessage } from "../server/sessions/jsonlCatalog.mjs";

const LOCAL_PI = process.env.PI_SQLITE_TEST_BIN ?? fileURLToPath(new URL("../pi/packages/coding-agent/dist/cli.js", import.meta.url));
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
    const text = body.includes("fork prompt") ? "fork response" : "durable phrase foo-bar";
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
    const rootId = (await sourceCatalog.list({ cwd }))[0].id;
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
    assert.equal((await catalog.list()).find((session) => session.id !== rootId).parentSessionId, rootId);
  });

  test("SQLite full-text search supports punctuation, AND, OR, and phrases", async () => {
    const { catalog, rootIdentity } = await createProcessFixture();
    const punctuation = await catalog.search({ q: "foo-bar", scope: "session", path: rootIdentity });
    assert.equal(punctuation.results.length, 1);
    assert.equal(punctuation.results[0].snippet.match, "foo-bar");
    assert.equal((await catalog.search({ q: "bar durable", scope: "session", path: rootIdentity })).results.length, 1);
    assert.equal((await catalog.search({ q: "root durable", scope: "session", path: rootIdentity })).results.length, 0);
    assert.equal((await catalog.search({ q: "missing OR durable", scope: "session", path: rootIdentity })).results.length, 1);
    assert.equal((await catalog.search({ q: '"durable phrase"', scope: "session", path: rootIdentity })).results.length, 1);
    assert.equal((await catalog.search({ q: '"phrase durable"', scope: "session", path: rootIdentity })).results.length, 0);
  });
}

test("SQLite catalog exposes a persisted harness in summaries and search hits", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-sqlite-catalog-harness-"));
  roots.push(root);
  const path = join(root, "sessions.sqlite");
  const writer = new DatabaseSync(path);
  schema(writer);
  writer.prepare(`INSERT INTO sessions
    (id, created_at, cwd, metadata, active_leaf_id, updated_at, first_message, all_messages_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("claude-session", "2026-01-01", "/work", JSON.stringify({ harness: "claude-code" }), "u1", "2026-01-01", "claude durable", "claude durable");
  writer.prepare(`INSERT INTO session_entries
    (session_id, id, entry_seq, parent_id, type, timestamp, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("claude-session", "u1", 1, null, "message", "2026-01-01", JSON.stringify({ message: { role: "user", content: "claude durable" } }));
  writer.prepare("INSERT INTO session_materialized (session_id, payload) VALUES (?, ?)")
    .run("claude-session", JSON.stringify({ messageCount: 1 }));
  writer.close();

  const catalog = createSqliteSessionCatalog({ databasePath: path });
  assert.equal((await catalog.list())[0].harness, "claude-code");
  assert.equal((await catalog.search({ q: "claude durable", scope: "all" })).results[0].harness, "claude-code");
});

test("canonical transcript messages omit persisted binary payloads", () => {
  const entry = {
    type: "message",
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "toolResult", content: [
      { type: "text", text: "image dimensions" },
      { type: "image", mimeType: "image/png", data: "base64-payload" },
    ] },
  };
  assert.deepEqual(transcriptMessage(entry), {
    role: "toolResult",
    content: [
      { type: "text", text: "image dimensions" },
      { type: "image", mimeType: "image/png" },
    ],
    entryTimestamp: "2026-01-01T00:00:00Z",
  });
  assert.equal(entry.message.content[1].data, "base64-payload");
});

test("SQLite catalog keeps the full transcript and marks compaction in place", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-sqlite-catalog-compacted-"));
  roots.push(root);
  const path = join(root, "sessions.sqlite");
  const writer = new DatabaseSync(path);
  schema(writer);
  writer.prepare(`INSERT INTO sessions
    (id, created_at, cwd, active_leaf_id, updated_at, first_message, all_messages_text)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("compacted", "2026-01-01", "/work", "a2", "2026-01-01", "before", "before older answer after newer answer");
  const insert = writer.prepare(`INSERT INTO session_entries
    (session_id, id, entry_seq, parent_id, type, timestamp, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insert.run("compacted", "u1", 1, null, "message", "2026-01-01T00:00:01Z", JSON.stringify({ message: { role: "user", content: "before" } }));
  insert.run("compacted", "a1", 2, "u1", "message", "2026-01-01T00:00:02Z", JSON.stringify({ message: { role: "assistant", content: "older answer" } }));
  insert.run("compacted", "c1", 3, "a1", "compaction", "2026-01-01T00:00:03Z", JSON.stringify({ summary: "summary", firstKeptEntryId: "u1", tokensBefore: 1234 }));
  insert.run("compacted", "u2", 4, "c1", "message", "2026-01-01T00:00:04Z", JSON.stringify({ message: { role: "user", content: "after" } }));
  insert.run("compacted", "a2", 5, "u2", "message", "2026-01-01T00:00:05Z", JSON.stringify({ message: { role: "assistant", content: "newer answer" } }));
  writer.close();

  const messages = (await createSqliteSessionCatalog({ databasePath: path }).messages("compacted")).messages;
  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "compactionSummary", "user", "assistant"]);
  assert.equal(messages[2].tokensBefore, 1234);
});

test("SQLite catalog preserves query failures when closing the read handle also fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-sqlite-catalog-close-error-"));
  roots.push(root);
  const path = join(root, "sessions.sqlite");
  writeFileSync(path, "");
  const queryError = new Error("query failed");
  const closeError = new Error("close failed");
  const failingCatalog = createSqliteSessionCatalog({
    databasePath: path,
    databaseFactory: () => ({
      prepare() { throw queryError; },
      close() { throw closeError; },
    }),
  });
  await assert.rejects(() => failingCatalog.list(), (error) => error === queryError);

  const closeOnlyCatalog = createSqliteSessionCatalog({
    databasePath: path,
    databaseFactory: () => ({
      prepare() { return { all: () => [] }; },
      close() { throw closeError; },
    }),
  });
  await assert.rejects(() => closeOnlyCatalog.list(), (error) => error === closeError);
});

test("SQLite catalog skips malformed entry payloads and closes every read handle", async () => {
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
  assert.equal((await catalog.list())[0].name, null);
  assert.deepEqual((await catalog.tree("broken")).nodes.map((node) => node.id), ["good"]);
  assert.deepEqual((await catalog.messages("broken")).messages.map((message) => message.content), ["durable phrase"]);
  assert.equal(closes, 3);
});

test("SQLite catalog treats database columns as authoritative and tolerates malformed payload fields", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-sqlite-catalog-defensive-"));
  roots.push(root);
  const path = join(root, "sessions.sqlite");
  const writer = new DatabaseSync(path);
  schema(writer);
  writer.prepare(`INSERT INTO sessions
    (id, created_at, cwd, active_leaf_id, updated_at, first_message, all_messages_text)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("defensive", "2026-01-01", "/work", "real-id", "2026-01-01", Buffer.from("not text"), "durable");
  writer.prepare("INSERT INTO session_materialized VALUES (?, ?)")
    .run("defensive", JSON.stringify({ name: 123, messageCount: -4 }));
  writer.prepare(`INSERT INTO session_entries
    (session_id, id, entry_seq, parent_id, type, timestamp, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("defensive", "real-id", 1, null, "message", "database-time", JSON.stringify({
      id: "payload-id",
      parentId: "payload-parent",
      type: "session_info",
      timestamp: "payload-time",
      message: { role: "assistant", content: [{ type: "text", text: "durable text" }, null, 1, { type: "text", text: 42 }] },
    }));
  writer.close();

  const catalog = createSqliteSessionCatalog({ databasePath: path });
  assert.deepEqual((await catalog.list())[0], {
    id: "defensive",
    createdAt: "2026-01-01",
    modifiedAt: "2026-01-01",
    name: null,
    harness: "pi",
    cwd: "/work",
    parentSessionId: null,
    preview: null,
    messageCount: 0,
    storagePath: path,
  });
  assert.deepEqual((await catalog.tree("defensive")).nodes[0], {
    id: "real-id",
    parentId: null,
    type: "message",
    timestamp: "database-time",
    role: "assistant",
    label: "durable text",
  });
  assert.equal((await catalog.search({ q: "durable", scope: "session", path: "defensive" })).results[0].entryId, "real-id");
  await assert.rejects(() => catalog.summarize({ id: 123 }), /SQLite session ID is required/);
});

test("SQLite trigram search scans for quoted terms shorter than three characters", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-sqlite-catalog-short-search-"));
  roots.push(root);
  const path = join(root, "sessions.sqlite");
  const writer = new DatabaseSync(path);
  schema(writer);
  writer.exec(`CREATE VIRTUAL TABLE session_search_fts USING fts5(
    session_id UNINDEXED, entry_id UNINDEXED, role UNINDEXED, kind UNINDEXED,
    timestamp UNINDEXED, text, tokenize = 'trigram'
  )`);
  writer.prepare(`INSERT INTO sessions
    (id, created_at, cwd, active_leaf_id, updated_at, first_message, all_messages_text)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("short", "2026-01-01", "/work", "a1", "2026-01-01", "prompt", "a durable answer");
  writer.prepare(`INSERT INTO session_entries
    (session_id, id, entry_seq, parent_id, type, timestamp, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("short", "a1", 1, null, "message", "2026-01-01", JSON.stringify({ message: { role: "assistant", content: "a durable answer" } }));
  writer.prepare("INSERT INTO session_search_fts VALUES (?, ?, ?, ?, ?, ?)")
    .run("short", "a1", "assistant", "text", "2026-01-01", "a durable answer");
  writer.close();

  const catalog = createSqliteSessionCatalog({ databasePath: path });
  const short = await catalog.search({ q: '"a"', scope: "all" });
  assert.equal(short.results.length, 1);
  assert.equal(short.results[0].snippet.match, "a");
  const missing = await catalog.search({ q: "missing", scope: "all" });
  assert.equal(missing.results.length, 0);
  assert.equal(missing.filesSearched, 1);
});

test("SQLite catalog reads committed WAL updates while another handle remains open", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-sqlite-catalog-wal-"));
  roots.push(root);
  const path = join(root, "sessions.sqlite");
  const writer = new DatabaseSync(path);
  writer.exec("PRAGMA journal_mode=WAL");
  schema(writer);
  const insert = writer.prepare("INSERT INTO sessions VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?)");
  insert.run("one", "2026-01-01", "/work", "2026-01-01", "one", "one");
  const catalog = createSqliteSessionCatalog({ databasePath: path });
  assert.deepEqual((await catalog.list()).map((session) => session.id), ["one"]);
  insert.run("two", "2026-01-02", "/work", "2026-01-02", "two", "two");
  assert.deepEqual((await catalog.list()).map((session) => session.id), ["two", "one"]);
  writer.close();
});
