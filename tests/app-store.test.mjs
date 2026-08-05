import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";

test("app store creates its database directory and closes idempotently", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-app-store-"));
  const databasePath = join(root, "nested", "oyster.sqlite");
  const store = await openAppStore({ databasePath });
  t.after(async () => {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  });

  assert.equal(store.path, resolve(databasePath));
  assert.equal(existsSync(databasePath), true);
  assert.deepEqual(Object.keys(store.repositories), ["settings", "checkpoints", "sessions", "routines", "hublots", "pinnedWidgets", "webPush", "runners", "runnerEvents", "migrationLedger", "operations"]);
  assert.deepEqual(await store.hydrate(), { settings: [], hublots: [], incompleteOperations: [] });
  assert.deepEqual(store.migrationStatus, { currentVersion: 16, appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] });
  assert.equal(Object.isFrozen(store.repositories), true);
  assert.equal(store.closed, false);

  await store.close();
  await store.close();
  assert.equal(store.closed, true);
});

test("app store configures durability, integrity, and contention pragmas", async () => {
  const statements = [];
  class FakeDatabase {
    exec(sql) { statements.push(sql); }
    prepare() {}
    close() {}
  }

  const store = await openAppStore({ databasePath: join(tmpdir(), "oyster-pragma-store.sqlite"), Database: FakeDatabase, migrate: () => ({}) });
  await store.close();

  assert.equal(statements.length, 1);
  assert.match(statements[0], /PRAGMA journal_mode = WAL;/);
  assert.match(statements[0], /PRAGMA foreign_keys = ON;/);
  assert.match(statements[0], /PRAGMA busy_timeout = 5000;/);
  assert.match(statements[0], /PRAGMA synchronous = NORMAL;/);
});

test("app store exposes asynchronous commit and rollback without exposing its database", async () => {
  const statements = [];
  class FakeDatabase {
    exec(sql) { statements.push(sql.trim()); }
    prepare() {}
    close() {}
  }
  const store = await openAppStore({
    databasePath: join(tmpdir(), "oyster-transaction-store.sqlite"),
    Database: FakeDatabase,
    migrate: () => ({ currentVersion: 0, appliedVersions: [] }),
  });

  assert.equal(await store.transaction(async (repositories) => {
    assert.equal(repositories, store.repositories);
    await Promise.resolve();
    return "committed";
  }), "committed");
  await assert.rejects(() => store.transaction(() => { throw new Error("rollback me"); }), /rollback me/);
  assert.deepEqual(statements.slice(-4), ["BEGIN IMMEDIATE", "COMMIT", "BEGIN IMMEDIATE", "ROLLBACK"]);
  assert.equal("database" in store, false);
  await store.close();
});

test("app store checkpoints WAL writes before close", async () => {
  const statements = [];
  class FakeDatabase {
    exec(sql) { statements.push(sql.trim()); }
    prepare() {}
    close() { statements.push("CLOSE"); }
  }
  const store = await openAppStore({ databasePath: join(tmpdir(), "oyster-flush-store.sqlite"), Database: FakeDatabase, migrate: () => ({}) });
  await store.flush();
  await store.close();
  await store.flush();
  assert.deepEqual(statements.slice(-2), ["PRAGMA wal_checkpoint(PASSIVE)", "CLOSE"]);
});

test("app store closes its owned database exactly once", async () => {
  let openedPath = null;
  let closes = 0;
  class FakeDatabase {
    constructor(path) { openedPath = path; }
    exec() {}
    prepare() {}
    close() { closes++; }
  }

  const databasePath = join(tmpdir(), "oyster-fake-store.sqlite");
  const store = await openAppStore({ databasePath, Database: FakeDatabase, migrate: () => ({}) });
  await store.close();
  await store.close();

  assert.equal(openedPath, resolve(databasePath));
  assert.equal(closes, 1);
});

test("app store closes the database when configuration or migration fails", async () => {
  let closes = 0;
  class FakeDatabase {
    exec() {}
    prepare() {}
    close() { closes++; }
  }
  const databasePath = join(tmpdir(), "oyster-failed-store.sqlite");

  await assert.rejects(async () => await openAppStore({
    databasePath,
    Database: FakeDatabase,
    migrate: () => { throw new Error("migration failed"); },
  }), /migration failed/);
  assert.equal(closes, 1);
  const asyncMigrationStore = await openAppStore({
    databasePath,
    Database: FakeDatabase,
    migrate: async () => ({}),
  });
  await asyncMigrationStore.close();
  assert.equal(closes, 2);

  class InvalidDatabase {
    close() { closes++; }
  }
  await assert.rejects(async () => await openAppStore({ databasePath, Database: InvalidDatabase, migrate: () => ({}) }), /invalid database/);
  assert.equal(closes, 3);
});

test("app store recovers when beginning a transaction fails", async () => {
  let failBegin = true;
  class FakeDatabase {
    exec(sql) {
      if (sql === "BEGIN IMMEDIATE" && failBegin) {
        failBegin = false;
        throw new Error("busy");
      }
    }
    prepare() {}
    close() {}
  }
  const store = await openAppStore({ databasePath: join(tmpdir(), "oyster-begin-store.sqlite"), Database: FakeDatabase, migrate: () => ({}) });

  await assert.rejects(() => store.transaction(() => {}), /busy/);
  assert.equal(await store.transaction(() => "retried"), "retried");
  await store.close();
});
