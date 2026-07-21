import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";

test("app store creates its database directory and closes idempotently", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-app-store-"));
  const databasePath = join(root, "nested", "pi-lot-ui.sqlite");
  const store = openAppStore({ databasePath });
  t.after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  assert.equal(store.path, resolve(databasePath));
  assert.equal(existsSync(databasePath), true);
  assert.deepEqual(Object.keys(store.repositories), ["settings", "checkpoints", "sessions", "routines", "hublots", "runners", "runnerEvents", "migrationLedger", "operations"]);
  assert.deepEqual(store.hydrate(), { settings: [], hublots: [], incompleteOperations: [] });
  assert.deepEqual(store.migrationStatus, { currentVersion: 11, appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] });
  assert.equal(Object.isFrozen(store.repositories), true);
  assert.equal(store.closed, false);

  store.close();
  store.close();
  assert.equal(store.closed, true);
});

test("app store configures durability, integrity, and contention pragmas", () => {
  const statements = [];
  class FakeDatabase {
    exec(sql) { statements.push(sql); }
    close() {}
  }

  const store = openAppStore({ databasePath: join(tmpdir(), "pi-ui-pragma-store.sqlite"), Database: FakeDatabase, migrate: () => ({}) });
  store.close();

  assert.equal(statements.length, 1);
  assert.match(statements[0], /PRAGMA journal_mode = WAL;/);
  assert.match(statements[0], /PRAGMA foreign_keys = ON;/);
  assert.match(statements[0], /PRAGMA busy_timeout = 5000;/);
  assert.match(statements[0], /PRAGMA synchronous = NORMAL;/);
});

test("app store exposes synchronous commit and rollback without exposing its database", () => {
  const statements = [];
  class FakeDatabase {
    exec(sql) { statements.push(sql.trim()); }
    close() {}
  }
  const store = openAppStore({
    databasePath: join(tmpdir(), "pi-ui-transaction-store.sqlite"),
    Database: FakeDatabase,
    migrate: () => ({ currentVersion: 0, appliedVersions: [] }),
  });

  assert.equal(store.transaction((repositories) => {
    assert.equal(repositories, store.repositories);
    return "committed";
  }), "committed");
  assert.throws(() => store.transaction(() => { throw new Error("rollback me"); }), /rollback me/);
  assert.throws(() => store.transaction(async () => {}), /must be synchronous/);
  assert.deepEqual(statements.slice(-6), ["BEGIN IMMEDIATE", "COMMIT", "BEGIN IMMEDIATE", "ROLLBACK", "BEGIN IMMEDIATE", "ROLLBACK"]);
  assert.equal("database" in store, false);
  store.close();
});

test("app store checkpoints WAL writes before close", () => {
  const statements = [];
  class FakeDatabase {
    exec(sql) { statements.push(sql.trim()); }
    close() { statements.push("CLOSE"); }
  }
  const store = openAppStore({ databasePath: join(tmpdir(), "pi-ui-flush-store.sqlite"), Database: FakeDatabase, migrate: () => ({}) });
  store.flush();
  store.close();
  store.flush();
  assert.deepEqual(statements.slice(-2), ["PRAGMA wal_checkpoint(PASSIVE)", "CLOSE"]);
});

test("app store closes its owned database exactly once", () => {
  let openedPath = null;
  let closes = 0;
  class FakeDatabase {
    constructor(path) { openedPath = path; }
    exec() {}
    close() { closes++; }
  }

  const databasePath = join(tmpdir(), "pi-ui-fake-store.sqlite");
  const store = openAppStore({ databasePath, Database: FakeDatabase, migrate: () => ({}) });
  store.close();
  store.close();

  assert.equal(openedPath, resolve(databasePath));
  assert.equal(closes, 1);
});
