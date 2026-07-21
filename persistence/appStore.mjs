import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations } from "./migrations.mjs";

/**
 * Open the single pi-lot-ui application database owned by the stable server.
 *
 * The stable core keeps this service on `state.appStore`, so hot-reloaded
 * application modules receive the same repository registry and connection.
 * Domain repositories are added to this registry as their migrations land;
 * callers must never open their own application-database connections.
 */
export function openAppStore({ databasePath, Database = DatabaseSync, migrate = applyMigrations } = {}) {
  if (!databasePath) throw new Error("application database path is required");
  const path = resolve(databasePath);
  mkdirSync(dirname(path), { recursive: true });

  const database = new Database(path);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
  `);
  const migrationStatus = migrate(database);
  const repositories = Object.freeze({
    settings: Object.freeze({
      list: () => database.prepare("SELECT key, value, updated_at FROM app_settings ORDER BY key").all().map((row) => ({ ...row })),
    }),
    operations: Object.freeze({
      listIncomplete: () => database.prepare("SELECT id, kind, status, stage, payload, error, created_at, updated_at FROM operations WHERE status NOT IN ('completed', 'cancelled') ORDER BY created_at, id").all().map((row) => ({ ...row })),
      markRunningInterrupted: (updatedAt) => database.prepare("UPDATE operations SET status = 'interrupted', error = COALESCE(error, 'server restarted during operation'), updated_at = ? WHERE status = 'running'").run(updatedAt).changes,
    }),
  });
  let closed = false;
  let transactionOpen = false;

  function transaction(work) {
    if (closed) throw new Error("application database is closed");
    if (transactionOpen) throw new Error("nested application database transactions are not supported");
    transactionOpen = true;
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = work(repositories);
      if (result && typeof result.then === "function") {
        throw new Error("application database transactions must be synchronous");
      }
      database.exec("COMMIT");
      return result;
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      throw error;
    } finally {
      transactionOpen = false;
    }
  }

  function reconcileInterruptedOperations(now = new Date().toISOString()) {
    return transaction(() => repositories.operations.markRunningInterrupted(now));
  }

  function hydrate() {
    if (closed) throw new Error("application database is closed");
    return Object.freeze({
      settings: Object.freeze(repositories.settings.list()),
      incompleteOperations: Object.freeze(repositories.operations.listIncomplete()),
    });
  }

  function flush() {
    if (closed) return;
    database.exec("PRAGMA wal_checkpoint(PASSIVE)");
  }

  return Object.freeze({
    path,
    repositories,
    migrationStatus,
    transaction,
    reconcileInterruptedOperations,
    hydrate,
    flush,
    get closed() { return closed; },
    close() {
      if (closed) return;
      closed = true;
      database.close();
    },
  });
}
