import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionOperations } from "../session-operations.mjs";
import { createSessionReferenceCodec } from "../session-references.mjs";
import { createSqliteSessionCatalog } from "../sessions/sqliteCatalog.mjs";

const LOCAL_PI = "/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js";

test("SQLite deletion delegates to the configured pi repository operation", {
  skip: process.env.PI_SQLITE_CONTRACT_TEST === "skip" ? "PI_SQLITE_CONTRACT_TEST=skip" : false,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-session-operation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const databasePath = join(root, "sessions.sqlite");
  const module = await import("file:///home/ubuntu/pi-coding-agent/packages/coding-agent/dist/core/sqlite-session-repository.js");
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
