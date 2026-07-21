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
  assert.equal(duplicate.status, "active");

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

test("checkpoint repository atomically replaces and reloads backend-neutral records", (t) => {
  const { path, Database } = fixture(t);
  const first = openAppStore({ databasePath: path, Database });
  const checkpoint = {
    hash: "abc123", anchorId: "entry-1", leafId: "entry-2", dir: "/work",
    sessionRef: { backend: "sqlite", id: "session-1", storagePath: "/agent/sessions.sqlite" },
    message: "saved", timestamp: "2026-07-16T00:00:00.000Z",
  };
  first.repositories.checkpoints.save({ "session-1": [checkpoint] });
  assert.deepEqual(first.repositories.checkpoints.load(), { "session-1": [checkpoint] });
  first.close();

  const second = openAppStore({ databasePath: path, Database });
  t.after(() => second.close());
  assert.deepEqual(second.repositories.checkpoints.load(), { "session-1": [checkpoint] });
  second.repositories.checkpoints.save({});
  assert.deepEqual(second.repositories.checkpoints.load(), {});
});

test("checkpoint row operations isolate identities and replace fork inheritance", (t) => {
  const { path, Database } = fixture(t);
  const store = openAppStore({ databasePath: path, Database });
  t.after(() => store.close());
  const sqliteRef = { backend: "sqlite", id: "shared", storagePath: "/agent/sessions.sqlite" };
  const jsonlRef = { backend: "jsonl", id: "shared", storagePath: "/agent/sessions/shared.jsonl" };
  const sqliteCheckpoint = { hash: "same", anchorId: "sqlite-entry", sessionRef: sqliteRef, timestamp: "sqlite-time" };
  const jsonlCheckpoint = { hash: "same", anchorId: "jsonl-entry", sessionRef: jsonlRef, sessionPath: jsonlRef.storagePath, timestamp: "jsonl-time" };

  assert.deepEqual(store.repositories.checkpoints.record(sqliteRef, sqliteCheckpoint), sqliteCheckpoint);
  assert.deepEqual(store.repositories.checkpoints.record(jsonlRef, jsonlCheckpoint), jsonlCheckpoint);
  assert.deepEqual(store.repositories.checkpoints.listForSession(sqliteRef), [sqliteCheckpoint]);
  assert.deepEqual(store.repositories.checkpoints.listBySessionId("shared", "jsonl"), [jsonlCheckpoint]);
  assert.deepEqual(store.repositories.checkpoints.findBySessionId("shared", "sqlite", "same"), sqliteCheckpoint);

  const forkRef = { backend: "sqlite", id: "fork", storagePath: sqliteRef.storagePath };
  const inherited = [{ ...sqliteCheckpoint, sessionRef: forkRef }];
  store.repositories.checkpoints.replaceForSession(forkRef, inherited);
  assert.deepEqual(store.repositories.checkpoints.listForSession(forkRef), inherited);
  store.repositories.checkpoints.replaceForSession(forkRef, []);
  assert.deepEqual(store.repositories.checkpoints.listForSession(forkRef), []);
});

test("deleting one app-session owner cascades only its checkpoint rows", (t) => {
  const { path, Database } = fixture(t);
  const store = openAppStore({ databasePath: path, Database });
  t.after(() => store.close());
  const rootRef = { backend: "sqlite", id: "root", storagePath: "/agent/sessions.sqlite" };
  const forkRef = { backend: "sqlite", id: "fork", storagePath: "/agent/sessions.sqlite" };
  const rootCheckpoint = { hash: "root-hash", anchorId: "root-entry", sessionRef: rootRef, timestamp: "root-time" };
  const forkCheckpoint = { hash: "fork-hash", anchorId: "fork-entry", sessionRef: forkRef, timestamp: "fork-time" };
  store.repositories.checkpoints.record(rootRef, rootCheckpoint);
  store.repositories.checkpoints.record(forkRef, forkCheckpoint);
  const rootOwner = store.repositories.sessions.find({ backend: rootRef.backend, sessionId: rootRef.id, storagePath: rootRef.storagePath });

  store.transaction((repositories) => repositories.sessions.delete(rootOwner.id));

  assert.deepEqual(store.repositories.checkpoints.listForSession(rootRef), []);
  assert.deepEqual(store.repositories.checkpoints.listForSession(forkRef), [forkCheckpoint]);
  assert.equal(store.repositories.sessions.find({ backend: forkRef.backend, sessionId: forkRef.id, storagePath: forkRef.storagePath }).status, "active");
});

test("startup hydration rebuilds durable snapshots without starting resources", (t) => {
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
    hublots: [],
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
  assert.deepEqual(second.migrationStatus, { currentVersion: 8, appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8] });
  assert.equal(databases[1].prepare("SELECT value FROM app_settings WHERE key = ?").get("workdir").value, '"/workspace"');
  assert.equal(databases[1].prepare("SELECT count(*) AS count FROM schema_migrations").get().count, 8);
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
