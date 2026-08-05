import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { APP_MIGRATIONS, applyMigrations } from "../server/persistence/migrations.mjs";

function databaseFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-migrations-"));
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

test("numbered migrations apply once and report stable status", async (t) => {
  const database = databaseFixture(t);
  let clockCalls = 0;
  const now = () => {
    clockCalls += 1;
    return "2026-07-16T00:00:00.000Z";
  };

  const first = await applyMigrations(database, { now });
  const second = await applyMigrations(database, { now });

  assert.equal(clockCalls, APP_MIGRATIONS.length);
  assert.deepEqual(first, { currentVersion: 16, appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] });
  assert.deepEqual(second, first);
  assert.deepEqual(tableNames(database), ["app_sessions", "app_settings", "checkpoints", "hublot_lifecycle_events", "hublot_processes", "hublots", "legacy_migration_ledger", "operations", "pinned_widget_groups", "pinned_widgets", "routine_log_lines", "routine_runs", "routines", "runner_events", "runners", "schema_migrations", "web_push_subscriptions", "web_push_vapid"]);
  assert.deepEqual(database.prepare("SELECT version, name, applied_at FROM schema_migrations").all().map((row) => ({ ...row })), [
    { version: 1, name: "foundation", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 2, name: "session_ownership", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 3, name: "session_deletion_state", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 4, name: "checkpoints", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 5, name: "routines", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 6, name: "hublots", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 7, name: "hublot_port_allocation", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 8, name: "runner_descriptors", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 9, name: "runner_replay_events", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 10, name: "legacy_migration_ledger", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 11, name: "session_archiving", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 12, name: "pinned_widgets", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 13, name: "browser_video_containers", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 14, name: "svg_media", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 15, name: "monitoring_widgets", applied_at: "2026-07-16T00:00:00.000Z" },
    { version: 16, name: "web_push", applied_at: "2026-07-16T00:00:00.000Z" },
  ]);
});

test("video-container migration upgrades existing AVI file widgets", async (t) => {
  const database = databaseFixture(t);
  await applyMigrations(database, { migrations: APP_MIGRATIONS.slice(0, 12) });
  database.prepare(`
    INSERT INTO pinned_widgets(
      id, owner_id, scope, group_id, kind, label, position, target, hublot_id,
      mime_type, size, mtime_ms, created_at, updated_at
    ) VALUES ('legacy-avi', NULL, 'workspace', NULL, 'file', 'Legacy AVI', 1,
      '/workspace/legacy.avi', NULL, 'application/octet-stream', 12, 1, 'now', 'now')
  `).run();
  await applyMigrations(database);
  assert.deepEqual({ ...database.prepare("SELECT kind, mime_type FROM pinned_widgets WHERE id = 'legacy-avi'").get() }, {
    kind: "video", mime_type: "video/x-msvideo",
  });
});

test("SVG migration upgrades existing vector file widgets", async (t) => {
  const database = databaseFixture(t);
  await applyMigrations(database, { migrations: APP_MIGRATIONS.slice(0, 13) });
  database.prepare(`
    INSERT INTO pinned_widgets(
      id, owner_id, scope, group_id, kind, label, position, target, hublot_id,
      mime_type, size, mtime_ms, created_at, updated_at
    ) VALUES ('legacy-svg', NULL, 'workspace', NULL, 'file', 'Legacy SVG', 1,
      '/workspace/legacy.svg', NULL, 'application/octet-stream', 12, 1, 'now', 'now')
  `).run();
  await applyMigrations(database);
  assert.deepEqual({ ...database.prepare("SELECT kind, mime_type FROM pinned_widgets WHERE id = 'legacy-svg'").get() }, {
    kind: "image", mime_type: "image/svg+xml",
  });
});

test("a failed migration rolls back its schema and ledger row", async (t) => {
  const database = databaseFixture(t);
  const migrations = [
    { version: 1, name: "broken", sql: "CREATE TABLE should_rollback(id INTEGER); THIS IS NOT SQL;" },
  ];

  await assert.rejects(async () => await applyMigrations(database, { migrations }), /migration 1 \(broken\) failed/);
  assert.deepEqual(tableNames(database), ["schema_migrations"]);
  assert.deepEqual(database.prepare("SELECT * FROM schema_migrations").all(), []);
});

test("migration definitions are validated before changing the database", async (t) => {
  const database = databaseFixture(t);
  const invalidLists = [
    null,
    [{ version: 2, name: "later", sql: "SELECT 1;" }, { version: 1, name: "earlier", sql: "SELECT 1;" }],
    [{ version: 0, name: "zero", sql: "SELECT 1;" }],
    [{ version: 1, name: "", sql: "SELECT 1;" }],
    [{ version: 1, name: "valid", sql: "  " }],
  ];

  for (const migrations of invalidLists) {
    await assert.rejects(async () => await applyMigrations(database, { migrations }), /migrations must be an array|unique ascending integer versions|invalid application database migration/);
  }
  assert.deepEqual(tableNames(database), []);
});

test("migration history must be a matching contiguous prefix", async (t) => {
  const database = databaseFixture(t);
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const insert = database.prepare("INSERT INTO schema_migrations VALUES (?, ?, 'now')");
  insert.run(2, "second");
  const migrations = [
    { version: 1, name: "first", sql: "SELECT 1;" },
    { version: 2, name: "second", sql: "SELECT 1;" },
  ];

  await assert.rejects(async () => await applyMigrations(database, { migrations }), /history has a gap/);
  database.exec("DELETE FROM schema_migrations");
  insert.run(1, "renamed");
  await assert.rejects(async () => await applyMigrations(database, { migrations }), /migration 1 name mismatch/);
  database.exec("DELETE FROM schema_migrations");
  insert.run(3, "future");
  await assert.rejects(async () => await applyMigrations(database, { migrations }), /migration 3 is not supported/);
});

test("migration dependencies and clock are validated", async (t) => {
  const database = databaseFixture(t);
  await assert.rejects(async () => await applyMigrations(null), /database connection is required/);
  await assert.rejects(async () => await applyMigrations(database, { now: "soon" }), /clock must be a function/);

  database.exec("BEGIN");
  await assert.rejects(async () => await applyMigrations(database), /inside a transaction/);
  database.exec("ROLLBACK");

  await assert.rejects(async () => await applyMigrations(database, {
    migrations: [{ version: 1, name: "clock", sql: "CREATE TABLE clock_test(id INTEGER)" }],
    now: () => null,
  }), /clock must return a timestamp string/);
  assert.deepEqual(tableNames(database), ["schema_migrations"]);
  assert.equal(database.isTransaction, false);
});
