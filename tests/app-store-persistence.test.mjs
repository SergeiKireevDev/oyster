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
      id: "pending", kind: "delete_session", status: "running", stage: "agent_delete",
      payload: null, error: null, created_at: "2026-07-16T00:00:00.000Z", updated_at: "2026-07-16T00:00:01.000Z",
    }],
  });
});

test("closing and reopening the app store preserves data without rerunning migrations", (t) => {
  const { path, databases, Database } = fixture(t);
  const first = openAppStore({ databasePath: path, Database });
  databases[0].prepare("INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)")
    .run("workdir", '"/workspace"', "2026-07-16T00:00:00.000Z");
  first.close();

  const second = openAppStore({ databasePath: path, Database });
  t.after(() => second.close());
  assert.deepEqual(second.migrationStatus, { currentVersion: 1, appliedVersions: [1] });
  assert.equal(databases[1].prepare("SELECT value FROM app_settings WHERE key = ?").get("workdir").value, '"/workspace"');
  assert.equal(databases[1].prepare("SELECT count(*) AS count FROM schema_migrations").get().count, 1);
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
