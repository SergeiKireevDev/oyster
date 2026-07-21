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
      set: (key, value, updatedAt) => database.prepare(`
        INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(key, value, updatedAt),
    }),
    checkpoints: Object.freeze({
      load: () => {
        const grouped = {};
        for (const row of database.prepare(`
          SELECT s.session_id, c.payload
          FROM checkpoints c JOIN app_sessions s ON s.id = c.owner_id
          ORDER BY c.created_at, c.id
        `).all()) {
          try { (grouped[row.session_id] ??= []).push(JSON.parse(row.payload)); } catch {}
        }
        return grouped;
      },
      save: (grouped) => {
        database.exec("BEGIN IMMEDIATE");
        try {
          database.exec("DELETE FROM checkpoints");
          const findOwner = database.prepare("SELECT id FROM app_sessions WHERE backend = ? AND session_id = ? AND storage_path IS ?");
          const insertOwner = database.prepare("INSERT INTO app_sessions(backend, session_id, storage_path, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING");
          const insertCheckpoint = database.prepare("INSERT INTO checkpoints(owner_id, git_hash, anchor_id, payload, created_at) VALUES (?, ?, ?, ?, ?)");
          for (const [sessionId, checkpoints] of Object.entries(grouped ?? {})) {
            for (const checkpoint of checkpoints ?? []) {
              const reference = checkpoint.sessionRef ?? (checkpoint.sessionPath
                ? { backend: "jsonl", id: sessionId, storagePath: checkpoint.sessionPath }
                : null);
              if (!reference?.backend || !reference.storagePath) throw new Error(`checkpoint ${checkpoint.hash ?? "unknown"} has no session identity`);
              const createdAt = checkpoint.timestamp ?? new Date().toISOString();
              insertOwner.run(reference.backend, reference.id ?? sessionId, reference.storagePath, createdAt);
              const owner = findOwner.get(reference.backend, reference.id ?? sessionId, reference.storagePath);
              insertCheckpoint.run(owner.id, checkpoint.hash, checkpoint.anchorId, JSON.stringify(checkpoint), createdAt);
            }
          }
          database.exec("COMMIT");
        } catch (error) {
          try { database.exec("ROLLBACK"); } catch {}
          throw error;
        }
      },
    }),
    sessions: Object.freeze({
      upsert: ({ backend, sessionId, storagePath = null, createdAt }) => {
        database.prepare(`
          INSERT INTO app_sessions(backend, session_id, storage_path, created_at) VALUES (?, ?, ?, ?)
          ON CONFLICT DO NOTHING
        `).run(backend, sessionId, storagePath, createdAt);
        return { ...database.prepare("SELECT id, backend, session_id, storage_path, status, created_at FROM app_sessions WHERE backend = ? AND session_id = ? AND storage_path IS ?").get(backend, sessionId, storagePath) };
      },
      find: ({ backend, sessionId, storagePath = null }) => {
        const row = database.prepare("SELECT id, backend, session_id, storage_path, status, created_at FROM app_sessions WHERE backend = ? AND session_id = ? AND storage_path IS ?").get(backend, sessionId, storagePath);
        return row ? { ...row } : null;
      },
      markDeleting: (id) => database.prepare("UPDATE app_sessions SET status = 'deleting' WHERE id = ?").run(id).changes,
      delete: (id) => database.prepare("DELETE FROM app_sessions WHERE id = ?").run(id).changes,
    }),
    operations: Object.freeze({
      create: ({ id, ownerId = null, kind, status, stage, payload = null, error = null, createdAt, updatedAt = createdAt }) => database.prepare(`
        INSERT INTO operations(id, owner_id, kind, status, stage, payload, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ownerId, kind, status, stage, payload, error, createdAt, updatedAt),
      find: (id) => {
        const row = database.prepare("SELECT id, owner_id, kind, status, stage, payload, error, created_at, updated_at FROM operations WHERE id = ?").get(id);
        return row ? { ...row } : null;
      },
      update: (id, { status, stage, error = null, updatedAt }) => database.prepare("UPDATE operations SET status = ?, stage = ?, error = ?, updated_at = ? WHERE id = ?").run(status, stage, error, updatedAt, id).changes,
      listIncomplete: () => database.prepare("SELECT id, owner_id, kind, status, stage, payload, error, created_at, updated_at FROM operations WHERE status NOT IN ('completed', 'cancelled') ORDER BY created_at, id").all().map((row) => ({ ...row })),
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
