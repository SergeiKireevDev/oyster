import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createSessionOperations } from "../session-operations.mjs";
import { createSessionReferenceCodec } from "../session-references.mjs";
import { createSqliteSessionCatalog } from "../sessions/sqliteCatalog.mjs";

const LOCAL_PI = process.env.PI_SQLITE_TEST_BIN ?? "/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js";
const SKIP_SQLITE_CONTRACT = process.env.PI_SQLITE_CONTRACT_TEST === "skip";
const SQLITE_REPOSITORY_MODULE = SKIP_SQLITE_CONTRACT
  ? null
  : pathToFileURL(join(dirname(realpathSync(LOCAL_PI)), "core", "sqlite-session-repository.js")).href;

test("SQLite deletion delegates to the configured pi repository operation", {
  skip: SKIP_SQLITE_CONTRACT ? "PI_SQLITE_CONTRACT_TEST=skip" : false,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-session-operation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const databasePath = join(root, "sessions.sqlite");
  const module = await import(SQLITE_REPOSITORY_MODULE);
  const repository = new module.CodingAgentSqliteSessionRepository(databasePath);
  const created = await repository.create({ id: "delete-me", cwd: root });
  await created.close();
  const codec = createSessionReferenceCodec({ agentDir: root, sqlitePath: databasePath });
  const operations = createSessionOperations({
    config: { PI_BIN: LOCAL_PI },
    sessionReferences: codec,
  });
  assert.equal(operations.capabilities.delete.sqlite, true);
  await operations.deleteSession({ backend: "sqlite", id: "delete-me", storagePath: databasePath });
  assert.equal(createSqliteSessionCatalog({ databasePath }).findById("delete-me"), null);
});

test("SQLite exact-entry fork delegates to pi and preserves parent identity", {
  skip: SKIP_SQLITE_CONTRACT ? "PI_SQLITE_CONTRACT_TEST=skip" : false,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-session-fork-operation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const databasePath = join(root, "sessions.sqlite");
  const module = await import(SQLITE_REPOSITORY_MODULE);
  const repository = new module.CodingAgentSqliteSessionRepository(databasePath);
  const source = await repository.create({ id: "source", cwd: root });
  await source.appendMessage({ role: "user", content: "fork here", timestamp: Date.now() });
  const entryId = await source.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  await source.close();
  const codec = createSessionReferenceCodec({ agentDir: root, sqlitePath: databasePath });
  const operations = createSessionOperations({ config: { PI_BIN: LOCAL_PI }, sessionReferences: codec });
  const fork = await operations.forkSession({ backend: "sqlite", id: "source", storagePath: databasePath }, {
    entryId, cwd: root, id: "forked",
  });
  assert.deepEqual(fork.sessionRef, { backend: "sqlite", id: "forked", storagePath: databasePath });
  assert.equal(createSqliteSessionCatalog({ databasePath }).findById("forked").parentSessionId, "source");
});

test("session operations expose capability failures without loading a repository", async () => {
  const codec = createSessionReferenceCodec({ agentDir: "/agent", sqlitePath: "/agent/sessions.sqlite" });
  const operations = createSessionOperations({
    config: { PI_BIN: "/missing/dist/cli.js" },
    sessionReferences: codec,
  });
  assert.equal(operations.capabilities.delete.sqlite, false);
  await assert.rejects(
    () => operations.deleteSession({ backend: "sqlite", id: "session", storagePath: "/agent/sessions.sqlite" }),
    (error) => error.code === "capability_unavailable",
  );
});

test("session route deletion releases resources only after repository success", async () => {
  const codec = createSessionReferenceCodec({ agentDir: "/agent", sqlitePath: "/agent/sessions.sqlite" });
  const reference = { backend: "sqlite", id: "session", storagePath: "/agent/sessions.sqlite" };
  const calls = [];
  class Repository {
    constructor(path) { calls.push(["construct", path]); }
    async deleteById(id) { calls.push(["delete", id]); }
  }
  const operations = createSessionOperations({
    config: { PI_BIN: "/virtual/dist/cli.js" },
    sessionReferences: codec,
    loadSqliteRepository: async () => Repository,
  });
  assert.deepEqual(await operations.deleteSession(reference), {
    backend: "sqlite", id: "session", deleted: codec.serialize(reference),
  });
  assert.deepEqual(calls, [["construct", "/agent/sessions.sqlite"], ["delete", "session"]]);
});
