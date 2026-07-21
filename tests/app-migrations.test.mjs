import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations } from "../persistence/migrations.mjs";

function databaseFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-migrations-"));
  const database = new DatabaseSync(join(root, "app.sqlite"));
  t.after(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  return database;
}

const tableNames = (database) => database.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
).all().map((row) => row.name);

test("numbered migrations apply once and report stable status", (t) => {
  const database = databaseFixture(t);
  const now = () => "2026-07-16T00:00:00.000Z";

  const first = applyMigrations(database, { now });
  const second = applyMigrations(database, { now });

  assert.deepEqual(first, { currentVersion: 2, appliedVersions: [1, 2] });
  assert.deepEqual(second, first);
  assert.deepEqual(tableNames(database), ["app_sessions", "app_settings", "operations", "schema_migrations"]);
  assert.deepEqual(database.prepare("SELECT version, name, applied_at FROM schema_migrations").all().map((row) => ({ ...row })), [
    { version: 1, name: "foundation", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 2, name: "session_ownership", applied_at: "2026-07-16T00:00:00.000Z" },
  ]);
});

test("a failed migration rolls back its schema and ledger row", (t) => {
  const database = databaseFixture(t);
  const migrations = [
    { version: 1, name: "broken", sql: "CREATE TABLE should_rollback(id INTEGER); THIS IS NOT SQL;" },
  ];

  assert.throws(() => applyMigrations(database, { migrations }), /migration 1 \(broken\) failed/);
  assert.deepEqual(tableNames(database), ["schema_migrations"]);
  assert.deepEqual(database.prepare("SELECT * FROM schema_migrations").all(), []);
});

test("migration numbering must be unique and ascending", (t) => {
  const database = databaseFixture(t);
  assert.throws(() => applyMigrations(database, { migrations: [
    { version: 2, name: "later", sql: "SELECT 1;" },
    { version: 1, name: "earlier", sql: "SELECT 1;" },
  ] }), /unique ascending integer versions/);
});
