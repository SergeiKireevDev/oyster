import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openAppStore } from "../persistence/appStore.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-app-persistence-"));
  const path = join(root, "pi-lot-ui.sqlite");
  const databases = [];
  class CapturingDatabase {
    constructor(databasePath) {
      const database = new DatabaseSync(databasePath);
      databases.push(database);
      return database;
    }
  }
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { path, databases, Database: CapturingDatabase };
}

test("foundation constraints and explicit rollback preserve consistent rows", (t) => {
  const { path, databases, Database } = fixture(t);
  const store = openAppStore({ databasePath: path, Database });
  t.after(() => store.close());
  const database = databases[0];

  database.prepare("INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)")
    .run("workdir", '"/workspace"', "2026-07-16T00:00:00.000Z");
  assert.throws(() => database.prepare("INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)")
    .run("workdir", '"/other"', "2026-07-16T00:00:01.000Z"), /constraint/i);
  assert.throws(() => database.prepare("INSERT INTO operations(id, kind, status, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("invalid", null, "pending", "start", "now", "now"), /constraint/i);

  database.exec("BEGIN IMMEDIATE");
  database.prepare("INSERT INTO operations(id, kind, status, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("rolled-back", "test", "pending", "start", "now", "now");
  database.exec("ROLLBACK");
  assert.equal(database.prepare("SELECT count(*) AS count FROM operations").get().count, 0);
});

test("session owners are unique and durable operations retain their journal after owner deletion", (t) => {
  const { path, Database } = fixture(t);
  const store = openAppStore({ databasePath: path, Database });
  t.after(() => store.close());

  const owner = store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "session-1", storagePath: null, createdAt: "created" });
  const duplicate = store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "session-1", storagePath: null, createdAt: "later" });
  assert.equal(duplicate.id, owner.id);
  assert.equal(duplicate.created_at, "created");

  store.transaction((repositories) => repositories.operations.create({
    id: "delete-1", ownerId: owner.id, kind: "delete_session", status: "pending",
    stage: "persisted", payload: '{"sessionId":"session-1"}', createdAt: "created",
  }));
  assert.equal(store.repositories.operations.find("delete-1").owner_id, owner.id);
  assert.equal(store.repositories.sessions.delete(owner.id), 1);
  assert.equal(store.repositories.operations.find("delete-1").owner_id, null);
  assert.equal(store.repositories.operations.update("delete-1", { status: "completed", stage: "done", updatedAt: "finished" }), 1);
  assert.equal(store.repositories.operations.find("delete-1").status, "completed");
});

test("startup hydration rebuilds settings and incomplete operation snapshots only", (t) => {
  const { path, databases, Database } = fixture(t);
  const store = openAppStore({ databasePath: path, Database });
  t.after(() => store.close());
  const database = databases[0];
  database.prepare("INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)")
    .run("workdir", '"/workspace"', "2026-07-16T00:00:00.000Z");
  const insertOperation = database.prepare("INSERT INTO operations(id, kind, status, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
  insertOperation.run("pending", "delete_session", "running", "agent_delete", "2026-07-16T00:00:00.000Z", "2026-07-16T00:00:01.000Z");
  insertOperation.run("done", "delete_session", "completed", "done", "2026-07-15T00:00:00.000Z", "2026-07-15T00:00:01.000Z");

  assert.deepEqual(store.hydrate(), {
    settings: [{ key: "workdir", value: '"/workspace"', updated_at: "2026-07-16T00:00:00.000Z" }],
    incompleteOperations: [{
      id: "pending", owner_id: null, kind: "delete_session", status: "running", stage: "agent_delete",
      payload: null, error: null, created_at: "2026-07-16T00:00:00.000Z", updated_at: "2026-07-16T00:00:01.000Z",
    }],
  });
});

test("startup reconciliation marks operations interrupted before hydration", (t) => {
  const { path, databases, Database } = fixture(t);
  const store = openAppStore({ databasePath: path, Database });
  t.after(() => store.close());
  databases[0].prepare("INSERT INTO operations(id, kind, status, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("running", "delete_session", "running", "agent_delete", "created", "started");

  assert.equal(store.reconcileInterruptedOperations("restarted"), 1);
  assert.equal(store.reconcileInterruptedOperations("again"), 0);
  assert.deepEqual(store.hydrate().incompleteOperations, [{
    id: "running", owner_id: null, kind: "delete_session", status: "interrupted", stage: "agent_delete",
    payload: null, error: "server restarted during operation", created_at: "created", updated_at: "restarted",
  }]);
});

test("closing and reopening the app store preserves data without rerunning migrations", (t) => {
  const { path, databases, Database } = fixture(t);
  const first = openAppStore({ databasePath: path, Database });
  databases[0].prepare("INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)")
    .run("workdir", '"/workspace"', "2026-07-16T00:00:00.000Z");
  first.close();

  const second = openAppStore({ databasePath: path, Database });
  t.after(() => second.close());
  assert.deepEqual(second.migrationStatus, { currentVersion: 2, appliedVersions: [1, 2] });
  assert.equal(databases[1].prepare("SELECT value FROM app_settings WHERE key = ?").get("workdir").value, '"/workspace"');
  assert.equal(databases[1].prepare("SELECT count(*) AS count FROM schema_migrations").get().count, 2);
});

test("WAL permits concurrent readers and committed cross-connection writes", (t) => {
  const { path, databases, Database } = fixture(t);
  const first = openAppStore({ databasePath: path, Database });
  const second = openAppStore({ databasePath: path, Database });
  t.after(() => { second.close(); first.close(); });
  const [writer, reader] = databases;

  assert.equal(writer.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(writer.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.equal(writer.prepare("PRAGMA busy_timeout").get().timeout, 5000);
  assert.equal(writer.prepare("PRAGMA synchronous").get().synchronous, 1);

  writer.exec("BEGIN IMMEDIATE");
  writer.prepare("INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)")
    .run("selected", '"r1"', "2026-07-16T00:00:00.000Z");
  assert.equal(reader.prepare("SELECT count(*) AS count FROM app_settings").get().count, 0);
  writer.exec("COMMIT");
  assert.equal(reader.prepare("SELECT value FROM app_settings WHERE key = ?").get("selected").value, '"r1"');
});
