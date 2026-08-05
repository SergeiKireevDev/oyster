import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openSqliteDatabase } from "./sqliteDatabase.mjs";
import { applyMigrations } from "./migrations.mjs";
import { assertGeneralAppSettingKey, assertGeneralAppSettingValue } from "./appSettings.mjs";

/**
 * Open the single oyster application database owned by the stable server.
 *
 * The stable core keeps this service on `state.appStore`, so hot-reloaded
 * application modules receive the same repository registry and connection.
 * Domain repositories are added to this registry as their migrations land;
 * callers must never open their own application-database connections.
 */
export async function openAppStore({ databasePath, Database = openSqliteDatabase, migrate = applyMigrations } = {}) {
  if (typeof databasePath !== "string" || !databasePath.trim()) {
    throw new Error("application database path is required");
  }
  if (typeof Database !== "function") throw new TypeError("application database constructor is required");
  if (typeof migrate !== "function") throw new TypeError("application database migration function is required");

  const path = resolve(databasePath);
  mkdirSync(dirname(path), { recursive: true });

  let database;
  let migrationStatus;
  try {
    database = await new Database(path);
    if (database && typeof database.prepare === "function" && typeof database.get !== "function") {
      const synchronous = database;
      database = Object.freeze({
        exec: async (sql) => synchronous.exec(sql),
        get: async (sql, ...params) => synchronous.prepare(sql).get(...params),
        all: async (sql, ...params) => synchronous.prepare(sql).all(...params),
        run: async (sql, ...params) => {
          const result = synchronous.prepare(sql).run(...params);
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        },
        close: async () => synchronous.close(),
      });
    }
    if (!database || typeof database.exec !== "function" || typeof database.get !== "function" || typeof database.all !== "function" || typeof database.run !== "function" || typeof database.close !== "function") {
      throw new TypeError("application database constructor returned an invalid database");
    }
    await database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA synchronous = NORMAL;
    `);
    migrationStatus = await migrate(database);
  } catch (error) {
    try { await database?.close?.(); } catch {}
    throw error;
  }

  async function writeAtomically(work) {
    if (transactionOpen) return work();
    await database.exec("BEGIN IMMEDIATE");
    try {
      const result = await work();
      await database.exec("COMMIT");
      return result;
    } catch (error) {
      try { await database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  const rawRepositories = Object.freeze({
    settings: Object.freeze({
      get: async (key) => {
        assertGeneralAppSettingKey(key);
        const row = await database.get("SELECT key, value, updated_at FROM app_settings WHERE key = ?", key);
        return row ? { ...row } : null;
      },
      list: async () => (await database.all("SELECT key, value, updated_at FROM app_settings ORDER BY key")).map((row) => ({ ...row })),
      set: async (key, value, updatedAt) => {
        assertGeneralAppSettingKey(key);
        assertGeneralAppSettingValue(value);
        return await database.run(`
          INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `, key, value, updatedAt);
      },
    }),
    checkpoints: Object.freeze({
      listForSession: async ({ backend, id, storagePath }) => (await database.all(`
        SELECT c.payload FROM checkpoints c
        JOIN app_sessions s ON s.id = c.owner_id
        WHERE s.backend = ? AND s.session_id = ? AND s.storage_path IS ?
        ORDER BY c.created_at, c.id
      `, backend, id, storagePath)).flatMap((row) => { try { return [JSON.parse(row.payload)]; } catch { return []; } }),
      listBySessionId: async (sessionId, backend) => (await database.all(`
        SELECT c.payload FROM checkpoints c
        JOIN app_sessions s ON s.id = c.owner_id
        WHERE s.session_id = ? AND s.backend = ?
        ORDER BY c.created_at, c.id
      `, sessionId, backend)).flatMap((row) => { try { return [JSON.parse(row.payload)]; } catch { return []; } }),
      findBySessionId: async (sessionId, backend, hash) => {
        const row = await database.get(`
          SELECT c.payload FROM checkpoints c
          JOIN app_sessions s ON s.id = c.owner_id
          WHERE s.session_id = ? AND s.backend = ? AND c.git_hash = ?
          ORDER BY c.id DESC LIMIT 1
        `, sessionId, backend, hash);
        try { return row ? JSON.parse(row.payload) : null; } catch { return null; }
      },
      record: (reference, checkpoint) => writeAtomically(async () => {
        const createdAt = checkpoint.timestamp ?? new Date().toISOString();
        await database.run("INSERT INTO app_sessions(backend, session_id, storage_path, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", reference.backend, reference.id, reference.storagePath, createdAt);
        const owner = await database.get("SELECT id FROM app_sessions WHERE backend = ? AND session_id = ? AND storage_path IS ?", reference.backend, reference.id, reference.storagePath);
        await database.run("INSERT INTO checkpoints(owner_id, git_hash, anchor_id, payload, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id, git_hash, anchor_id) DO NOTHING", owner.id, checkpoint.hash, checkpoint.anchorId, JSON.stringify(checkpoint), createdAt);
        const row = await database.get("SELECT payload FROM checkpoints WHERE owner_id = ? AND git_hash = ? AND anchor_id = ?", owner.id, checkpoint.hash, checkpoint.anchorId);
        return JSON.parse(row.payload);
      }),
      replaceForSession: (reference, checkpoints) => writeAtomically(async () => {
        const createdAt = checkpoints[0]?.timestamp ?? new Date().toISOString();
        await database.run("INSERT INTO app_sessions(backend, session_id, storage_path, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", reference.backend, reference.id, reference.storagePath, createdAt);
        const owner = await database.get("SELECT id FROM app_sessions WHERE backend = ? AND session_id = ? AND storage_path IS ?", reference.backend, reference.id, reference.storagePath);
        await database.run("DELETE FROM checkpoints WHERE owner_id = ?", owner.id);
        const insert = "INSERT INTO checkpoints(owner_id, git_hash, anchor_id, payload, created_at) VALUES (?, ?, ?, ?, ?)";
        for (const checkpoint of checkpoints) await database.run(insert, owner.id, checkpoint.hash, checkpoint.anchorId, JSON.stringify(checkpoint), checkpoint.timestamp ?? createdAt);
      }),
      deleteBySessionId: async (sessionId, backend) => (await database.run(`
        DELETE FROM checkpoints WHERE owner_id IN (
          SELECT id FROM app_sessions WHERE session_id = ? AND backend = ?
        )
      `, sessionId, backend)).changes,
      load: async () => {
        const grouped = {};
        for (const row of await database.all(`
          SELECT s.session_id, c.payload
          FROM checkpoints c JOIN app_sessions s ON s.id = c.owner_id
          ORDER BY c.created_at, c.id
        `)) {
          try { (grouped[row.session_id] ??= []).push(JSON.parse(row.payload)); } catch {}
        }
        return grouped;
      },
      save: (grouped) => writeAtomically(async () => {
        await database.exec("DELETE FROM checkpoints");
        const findOwner = "SELECT id FROM app_sessions WHERE backend = ? AND session_id = ? AND storage_path IS ?";
        const insertOwner = "INSERT INTO app_sessions(backend, session_id, storage_path, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING";
        const insertCheckpoint = "INSERT INTO checkpoints(owner_id, git_hash, anchor_id, payload, created_at) VALUES (?, ?, ?, ?, ?)";
        for (const [sessionId, checkpoints] of Object.entries(grouped ?? {})) {
          for (const checkpoint of checkpoints ?? []) {
            const reference = checkpoint.sessionRef ?? (checkpoint.sessionPath
              ? { backend: "jsonl", id: sessionId, storagePath: checkpoint.sessionPath }
              : null);
            if (!reference?.backend || !reference.storagePath) throw new Error(`checkpoint ${checkpoint.hash ?? "unknown"} has no session identity`);
            const createdAt = checkpoint.timestamp ?? new Date().toISOString();
            await database.run(insertOwner, reference.backend, reference.id ?? sessionId, reference.storagePath, createdAt);
            const owner = await database.get(findOwner, reference.backend, reference.id ?? sessionId, reference.storagePath);
            await database.run(insertCheckpoint, owner.id, checkpoint.hash, checkpoint.anchorId, JSON.stringify(checkpoint), createdAt);
          }
        }
      }),
    }),
    sessions: Object.freeze({
      upsert: async ({ backend, sessionId, storagePath = null, createdAt }) => {
        await database.run(`
          INSERT INTO app_sessions(backend, session_id, storage_path, created_at) VALUES (?, ?, ?, ?)
          ON CONFLICT DO NOTHING
        `, backend, sessionId, storagePath, createdAt);
        return { ...await database.get("SELECT id, backend, session_id, storage_path, status, archived, created_at FROM app_sessions WHERE backend = ? AND session_id = ? AND storage_path IS ?", backend, sessionId, storagePath) };
      },
      find: async ({ backend, sessionId, storagePath = null }) => {
        const row = await database.get("SELECT id, backend, session_id, storage_path, status, archived, created_at FROM app_sessions WHERE backend = ? AND session_id = ? AND storage_path IS ?", backend, sessionId, storagePath);
        return row ? { ...row } : null;
      },
      listBySessionId: async (sessionId) => (await database.all("SELECT id, backend, session_id, storage_path, status, archived, created_at FROM app_sessions WHERE session_id = ? ORDER BY id", sessionId)).map((row) => ({ ...row })),
      setArchived: async (id, archived) => (await database.run("UPDATE app_sessions SET archived = ? WHERE id = ?", archived ? 1 : 0, id)).changes,
      markDeleting: async (id) => (await database.run("UPDATE app_sessions SET status = 'deleting' WHERE id = ?", id)).changes,
      delete: async (id) => (await database.run("DELETE FROM app_sessions WHERE id = ?", id)).changes,
    }),
    routines: Object.freeze({
      list: async () => (await database.all(`
        SELECT r.id, r.owner_id, s.session_id, r.name, r.script, r.revision, r.cwd, r.created_at, r.updated_at
        FROM routines r LEFT JOIN app_sessions s ON s.id = r.owner_id ORDER BY r.name
      `)).map((row) => ({ ...row })),
      findByName: async (name) => {
        const row = await database.get(`
          SELECT r.id, r.owner_id, s.session_id, r.name, r.script, r.revision, r.cwd, r.created_at, r.updated_at
          FROM routines r LEFT JOIN app_sessions s ON s.id = r.owner_id WHERE r.name = ?
        `, name);
        return row ? { ...row } : null;
      },
      upsert: async ({ id, ownerId = null, name, script, cwd = null, now }) => {
        await database.run(`
          INSERT INTO routines(id, owner_id, name, script, cwd, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(name) DO UPDATE SET
            owner_id = excluded.owner_id, script = excluded.script, cwd = excluded.cwd,
            revision = routines.revision + 1, updated_at = excluded.updated_at
        `, id, ownerId, name, script, cwd, now, now);
        return { ...await database.get(`
          SELECT r.id, r.owner_id, s.session_id, r.name, r.script, r.revision, r.cwd, r.created_at, r.updated_at
          FROM routines r LEFT JOIN app_sessions s ON s.id = r.owner_id WHERE r.name = ?
        `, name) };
      },
      bind: async (id, ownerId, cwd, updatedAt) => (await database.run("UPDATE routines SET owner_id = ?, cwd = ?, updated_at = ? WHERE id = ?", ownerId, cwd, updatedAt, id)).changes,
      updateCwd: async (id, cwd, updatedAt) => (await database.run("UPDATE routines SET cwd = ?, updated_at = ? WHERE id = ?", cwd, updatedAt, id)).changes,
      release: async (id, updatedAt) => (await database.run("UPDATE routines SET owner_id = NULL, cwd = NULL, updated_at = ? WHERE id = ?", updatedAt, id)).changes,
      delete: async (id) => (await database.run("DELETE FROM routines WHERE id = ?", id)).changes,
      createRun: async ({ id, routineId, mode, status = "running", startedAt }) => {
        await database.run("INSERT INTO routine_runs(id, routine_id, mode, status, started_at) VALUES (?, ?, ?, ?, ?)", id, routineId, mode, status, startedAt);
        return { ...await database.get("SELECT * FROM routine_runs WHERE id = ?", id) };
      },
      updateProgress: async (id, progress, message) => (await database.run("UPDATE routine_runs SET progress = ?, message = ? WHERE id = ?", progress, message, id)).changes,
      updateRunStatus: async (id, status) => (await database.run("UPDATE routine_runs SET status = ? WHERE id = ?", status, id)).changes,
      finishRun: async (id, { status, result = null, finishedAt, exitCode = null, error = null }) => (await database.run(`
        UPDATE routine_runs SET status = ?, result = ?, finished_at = ?, exit_code = ?, error = ? WHERE id = ?
      `, status, result, finishedAt, exitCode, error, id)).changes,
      findRun: async (id) => {
        const row = await database.get("SELECT * FROM routine_runs WHERE id = ?", id);
        return row ? { ...row } : null;
      },
      listRuns: async (routineId) => (await database.all("SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY started_at, id", routineId)).map((row) => ({ ...row })),
      findLatestRun: async (routineId) => {
        const row = await database.get("SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY started_at DESC, id DESC LIMIT 1", routineId);
        return row ? { ...row } : null;
      },
      interruptUnfinishedRuns: async (finishedAt, error = "server restarted before the routine process finished") => (await database.run(`
        UPDATE routine_runs
        SET status = 'interrupted', finished_at = ?, error = COALESCE(error, ?)
        WHERE finished_at IS NULL
      `, finishedAt, error)).changes,
      appendLog: (runId, stream, text, createdAt, limit = 80) => {
        if (!Number.isInteger(limit) || limit < 1) throw new Error("routine log limit must be a positive integer");
        return writeAtomically(async () => {
          const next = (await database.get("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM routine_log_lines WHERE run_id = ?", runId)).sequence;
          await database.run("INSERT INTO routine_log_lines(run_id, sequence, stream, text, created_at) VALUES (?, ?, ?, ?, ?)", runId, next, stream, text, createdAt);
          await database.run("DELETE FROM routine_log_lines WHERE run_id = ? AND sequence <= ?", runId, next - limit);
          return next;
        });
      },
      listLogs: async (runId) => (await database.all("SELECT sequence, stream, text, created_at FROM routine_log_lines WHERE run_id = ? ORDER BY sequence", runId)).map((row) => ({ ...row })),
    }),
    hublots: Object.freeze({
      list: async () => (await database.all(`
        SELECT h.*, s.session_id FROM hublots h LEFT JOIN app_sessions s ON s.id = h.owner_id ORDER BY h.created_at, h.id
      `)).map((row) => ({ ...row })),
      find: async (id) => {
        const row = await database.get(`
          SELECT h.*, s.session_id FROM hublots h LEFT JOIN app_sessions s ON s.id = h.owner_id WHERE h.id = ?
        `, id);
        return row ? { ...row } : null;
      },
      create: async ({
        id, ownerId = null, port, label = null, brief = null, workdir,
        serviceKind, serviceStartScriptPath = null, serviceStartScript = null,
        serviceStartScriptSha256 = null, publicUrl = null, status,
        desiredState, restartCount = 0, nextRestartAt = null, createdAt,
        openedAt = null, closedAt = null, lastError = null,
      }) => {
        await database.run(`
          INSERT INTO hublots(
            id, owner_id, port, label, brief, workdir, service_kind,
            service_start_script_path, service_start_script, service_start_script_sha256,
            public_url, status, desired_state, restart_count, next_restart_at,
            created_at, opened_at, closed_at, last_error
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, id, ownerId, port, label, brief, workdir, serviceKind, serviceStartScriptPath, serviceStartScript, serviceStartScriptSha256, publicUrl, status, desiredState, restartCount, nextRestartAt, createdAt, openedAt, closedAt, lastError);
        return rawRepositories.hublots.find(id);
      },
      update: async (id, changes) => {
        const allowed = new Set([
          "owner_id", "port", "label", "brief", "workdir", "service_kind",
          "service_start_script_path", "service_start_script", "service_start_script_sha256",
          "public_url", "status", "desired_state", "restart_count", "next_restart_at",
          "opened_at", "closed_at", "last_error",
        ]);
        const entries = Object.entries(changes ?? {});
        if (!entries.length) return 0;
        for (const [column] of entries) if (!allowed.has(column)) throw new Error(`unsupported hublot field: ${column}`);
        return (await database.run(`UPDATE hublots SET ${entries.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`, ...entries.map(([, value]) => value), id)).changes;
      },
      delete: async (id) => (await database.run("DELETE FROM hublots WHERE id = ?", id)).changes,
      appendLifecycleEvent: async ({ hublotId, status, desiredState, publicUrl = null, error = null, createdAt }) => (await database.get(`
        INSERT INTO hublot_lifecycle_events(hublot_id, sequence, status, desired_state, public_url, error, created_at)
        SELECT ?, COALESCE(MAX(sequence), 0) + 1, ?, ?, ?, ?, ?
        FROM hublot_lifecycle_events WHERE hublot_id = ?
        RETURNING sequence
      `, hublotId, status, desiredState, publicUrl, error, createdAt, hublotId)).sequence,
      listLifecycleEvents: async (hublotId) => (await database.all(`
        SELECT hublot_id, sequence, status, desired_state, public_url, error, created_at
        FROM hublot_lifecycle_events WHERE hublot_id = ? ORDER BY sequence
      `, hublotId)).map((row) => ({ ...row })),
      upsertProcess: async ({
        id, hublotId, role, pid, processGroupId = null, bootId = null,
        procStartTicks = null, executable = null, commandSha256 = null,
        status, startedAt, observedAt = null, endedAt = null,
        exitCode = null, signal = null,
      }) => {
        await database.run(`
          INSERT INTO hublot_processes(
            id, hublot_id, role, pid, process_group_id, boot_id, proc_start_ticks,
            executable, command_sha256, status, started_at, observed_at, ended_at, exit_code, signal
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            hublot_id = excluded.hublot_id, role = excluded.role, pid = excluded.pid,
            process_group_id = excluded.process_group_id, boot_id = excluded.boot_id,
            proc_start_ticks = excluded.proc_start_ticks, executable = excluded.executable,
            command_sha256 = excluded.command_sha256, status = excluded.status,
            started_at = excluded.started_at, observed_at = excluded.observed_at,
            ended_at = excluded.ended_at, exit_code = excluded.exit_code, signal = excluded.signal
        `, id, hublotId, role, pid, processGroupId, bootId, procStartTicks, executable, commandSha256, status, startedAt, observedAt, endedAt, exitCode, signal);
        return { ...await database.get("SELECT * FROM hublot_processes WHERE id = ?", id) };
      },
      findProcess: async (id) => {
        const row = await database.get("SELECT * FROM hublot_processes WHERE id = ?", id);
        return row ? { ...row } : null;
      },
      updateProcess: async (id, changes) => {
        const allowed = new Set([
          "process_group_id", "boot_id", "proc_start_ticks", "executable", "command_sha256",
          "status", "observed_at", "ended_at", "exit_code", "signal",
        ]);
        const entries = Object.entries(changes ?? {});
        if (!entries.length) return 0;
        for (const [column] of entries) if (!allowed.has(column)) throw new Error(`unsupported hublot process field: ${column}`);
        return (await database.run(`UPDATE hublot_processes SET ${entries.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`, ...entries.map(([, value]) => value), id)).changes;
      },
      listProcesses: async (hublotId) => (await database.all("SELECT * FROM hublot_processes WHERE hublot_id = ? ORDER BY started_at, id", hublotId)).map((row) => ({ ...row })),
    }),
    pinnedWidgets: Object.freeze({
      list: async () => (await database.all(`
        SELECT w.*, s.session_id
        FROM pinned_widgets w LEFT JOIN app_sessions s ON s.id = w.owner_id
        ORDER BY w.scope, w.owner_id, w.group_id, w.position, w.id
      `)).map((row) => ({ ...row })),
      find: async (id) => {
        const row = await database.get(`
          SELECT w.*, s.session_id
          FROM pinned_widgets w LEFT JOIN app_sessions s ON s.id = w.owner_id
          WHERE w.id = ?
        `, id);
        return row ? { ...row } : null;
      },
      create: async ({
        id, ownerId = null, scope, groupId = null, kind, label, position,
        target = null, hublotId = null, mimeType = null, size = null,
        mtimeMs = null, createdAt, updatedAt = createdAt,
      }) => {
        await database.run(`
          INSERT INTO pinned_widgets(
            id, owner_id, scope, group_id, kind, label, position, target,
            hublot_id, mime_type, size, mtime_ms, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, id, ownerId, scope, groupId, kind, label, position, target, hublotId, mimeType, size, mtimeMs, createdAt, updatedAt);
        return rawRepositories.pinnedWidgets.find(id);
      },
      update: async (id, changes) => {
        const allowed = new Set([
          "owner_id", "scope", "group_id", "kind", "label", "position",
          "target", "hublot_id", "mime_type", "size", "mtime_ms", "updated_at",
        ]);
        const entries = Object.entries(changes ?? {});
        if (!entries.length) return 0;
        for (const [column] of entries) if (!allowed.has(column)) throw new Error(`unsupported pinned widget field: ${column}`);
        return (await database.run(`UPDATE pinned_widgets SET ${entries.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`, ...entries.map(([, value]) => value), id)).changes;
      },
      delete: async (id) => (await database.run("DELETE FROM pinned_widgets WHERE id = ?", id)).changes,
      nextPosition: async ({ ownerId = null, scope, groupId = null }) => Number((await database.get(`
        SELECT COALESCE(MAX(position), -1) + 1 AS position
        FROM pinned_widgets WHERE scope = ? AND owner_id IS ? AND group_id IS ?
      `, scope, ownerId, groupId)).position),
      listGroups: async () => (await database.all(`
        SELECT g.*, s.session_id
        FROM pinned_widget_groups g LEFT JOIN app_sessions s ON s.id = g.owner_id
        ORDER BY g.scope, g.owner_id, g.position, g.id
      `)).map((row) => ({ ...row })),
      findGroup: async (id) => {
        const row = await database.get(`
          SELECT g.*, s.session_id
          FROM pinned_widget_groups g LEFT JOIN app_sessions s ON s.id = g.owner_id
          WHERE g.id = ?
        `, id);
        return row ? { ...row } : null;
      },
      createGroup: async ({ id, ownerId = null, scope, name, position, createdAt, updatedAt = createdAt }) => {
        await database.run(`
          INSERT INTO pinned_widget_groups(id, owner_id, scope, name, position, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, id, ownerId, scope, name, position, createdAt, updatedAt);
        return rawRepositories.pinnedWidgets.findGroup(id);
      },
      updateGroup: async (id, changes) => {
        const allowed = new Set(["owner_id", "scope", "name", "position", "updated_at"]);
        const entries = Object.entries(changes ?? {});
        if (!entries.length) return 0;
        for (const [column] of entries) if (!allowed.has(column)) throw new Error(`unsupported pinned widget group field: ${column}`);
        return (await database.run(`UPDATE pinned_widget_groups SET ${entries.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`, ...entries.map(([, value]) => value), id)).changes;
      },
      deleteGroup: async (id) => (await database.run("DELETE FROM pinned_widget_groups WHERE id = ?", id)).changes,
      nextGroupPosition: async ({ ownerId = null, scope }) => Number((await database.get(`
        SELECT COALESCE(MAX(position), -1) + 1 AS position
        FROM pinned_widget_groups WHERE scope = ? AND owner_id IS ?
      `, scope, ownerId)).position),
    }),
    webPush: Object.freeze({
      getVapidKeys: async () => {
        const row = await database.get("SELECT public_key, private_key FROM web_push_vapid WHERE id = 1");
        return row ? { publicKey: row.public_key, privateKey: row.private_key } : null;
      },
      createVapidKeys: async ({ publicKey, privateKey, createdAt }) => {
        await database.run("INSERT OR IGNORE INTO web_push_vapid(id, public_key, private_key, created_at) VALUES (1, ?, ?, ?)", publicKey, privateKey, createdAt);
        return rawRepositories.webPush.getVapidKeys();
      },
      listSubscriptions: async () => (await database.all("SELECT endpoint, expiration_time, p256dh, auth, created_at, last_delivered_at FROM web_push_subscriptions ORDER BY created_at")).map((row) => ({ ...row })),
      upsertSubscription: async ({ endpoint, expirationTime, p256dh, auth, createdAt }) => {
        await database.run(`
          INSERT INTO web_push_subscriptions(endpoint, expiration_time, p256dh, auth, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET
            expiration_time = excluded.expiration_time, p256dh = excluded.p256dh,
            auth = excluded.auth, created_at = excluded.created_at
        `, endpoint, expirationTime, p256dh, auth, createdAt);
        return { ...await database.get("SELECT endpoint, expiration_time, p256dh, auth, created_at, last_delivered_at FROM web_push_subscriptions WHERE endpoint = ?", endpoint) };
      },
      markDelivered: async (endpoint, deliveredAt) => (await database.run("UPDATE web_push_subscriptions SET last_delivered_at = ? WHERE endpoint = ?", deliveredAt, endpoint)).changes,
      deleteSubscription: async (endpoint) => (await database.run("DELETE FROM web_push_subscriptions WHERE endpoint = ?", endpoint)).changes,
    }),
    runners: Object.freeze({
      list: async () => (await database.all("SELECT * FROM runners ORDER BY created_at, id")).map((row) => ({ ...row })),
      find: async (id) => {
        const row = await database.get("SELECT * FROM runners WHERE id = ?", id);
        return row ? { ...row } : null;
      },
      create: async ({
        id, ownerId = null, dir, sessionBackend = null, sessionId = null, sessionStoragePath = null,
        sessionName = null, isDefault = false, desiredState = "running", lastStatus = "starting",
        startCount = 0, createdAt, lastStartedAt = null, lastStoppedAt = null,
      }) => {
        await database.run(`
          INSERT INTO runners(
            id, owner_id, dir, session_backend, session_id, session_storage_path, session_name,
            is_default, desired_state, last_status, start_count, created_at, last_started_at, last_stopped_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, id, ownerId, dir, sessionBackend, sessionId, sessionStoragePath, sessionName, isDefault ? 1 : 0, desiredState, lastStatus, startCount, createdAt, lastStartedAt, lastStoppedAt);
        return rawRepositories.runners.find(id);
      },
      update: async (id, changes) => {
        const allowed = new Set([
          "owner_id", "dir", "session_backend", "session_id", "session_storage_path", "session_name",
          "is_default", "desired_state", "last_status", "start_count", "last_started_at", "last_stopped_at",
        ]);
        const entries = Object.entries(changes ?? {});
        if (!entries.length) return 0;
        for (const [column] of entries) if (!allowed.has(column)) throw new Error(`unsupported runner field: ${column}`);
        return (await database.run(`UPDATE runners SET ${entries.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`, ...entries.map(([, value]) => value), id)).changes;
      },
      setDefault: async (id) => {
        if (id != null && !await rawRepositories.runners.find(id)) throw new Error(`no such runner: ${id}`);
        await database.exec("SAVEPOINT set_runner_default");
        try {
          await database.run("UPDATE runners SET is_default = 0 WHERE is_default = 1");
          if (id != null) await database.run("UPDATE runners SET is_default = 1 WHERE id = ?", id);
          await database.exec("RELEASE set_runner_default");
        } catch (error) {
          await database.exec("ROLLBACK TO set_runner_default; RELEASE set_runner_default");
          throw error;
        }
        return id == null ? null : rawRepositories.runners.find(id);
      },
      delete: async (id) => (await database.run("DELETE FROM runners WHERE id = ?", id)).changes,
    }),
    runnerEvents: Object.freeze({
      list: async (runnerId, { maxPayloadBytes = null } = {}) => {
        if (maxPayloadBytes !== null && (!Number.isInteger(maxPayloadBytes) || maxPayloadBytes < 1)) {
          throw new Error("runner event payload cap must be a positive integer");
        }
        const rows = maxPayloadBytes === null
          ? await database.all(`
              SELECT runner_id, sequence, sse_id, payload, created_at
              FROM runner_events WHERE runner_id = ? ORDER BY sequence
            `, runnerId)
          : await database.all(`
              SELECT runner_id, sequence, sse_id, payload, created_at
              FROM runner_events
              WHERE runner_id = ? AND length(CAST(payload AS BLOB)) <= ?
              ORDER BY sequence
            `, runnerId, maxPayloadBytes);
        return rows.map((row) => ({ ...row }));
      },
      append: ({ runnerId, sseId = null, payload, createdAt, maxEntries = 400 }) => {
        if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("runner event cap must be a positive integer");
        const append = async () => {
          if (sseId != null) {
            const existing = await database.get("SELECT runner_id, sequence, sse_id, payload, created_at FROM runner_events WHERE runner_id = ? AND sse_id = ?", runnerId, sseId);
            if (existing) return { ...existing };
          }
          const sequence = Number((await database.get("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM runner_events WHERE runner_id = ?", runnerId)).sequence);
          await database.run("INSERT INTO runner_events(runner_id, sequence, sse_id, payload, created_at) VALUES (?, ?, ?, ?, ?)", runnerId, sequence, sseId, payload, createdAt);
          await database.run(`
            DELETE FROM runner_events WHERE runner_id = ? AND sequence <= (
              SELECT COALESCE(MAX(sequence), 0) - ? FROM runner_events WHERE runner_id = ?
            )
          `, runnerId, maxEntries, runnerId);
          return { ...await database.get("SELECT runner_id, sequence, sse_id, payload, created_at FROM runner_events WHERE runner_id = ? AND sequence = ?", runnerId, sequence) };
        };
        return writeAtomically(append);
      },
      deleteForRunner: async (runnerId) => (await database.run("DELETE FROM runner_events WHERE runner_id = ?", runnerId)).changes,
    }),
    migrationLedger: Object.freeze({
      list: async () => (await database.all("SELECT * FROM legacy_migration_ledger ORDER BY started_at, id")).map((row) => ({ ...row })),
      find: async (id) => {
        const row = await database.get("SELECT * FROM legacy_migration_ledger WHERE id = ?", id);
        return row ? { ...row } : null;
      },
      start: async ({ id, mode, startedAt }) => await database.run(`
        INSERT INTO legacy_migration_ledger(id, mode, status, started_at) VALUES (?, ?, 'running', ?)
      `, id, mode, startedAt),
      finish: async ({ id, status, sourceCounts = null, destinationCounts = null, conflicts = null, error = null, finishedAt }) => (await database.run(`
        UPDATE legacy_migration_ledger
        SET status = ?, source_counts = ?, destination_counts = ?, conflicts = ?, error = ?, finished_at = ?
        WHERE id = ?
      `, status, sourceCounts == null ? null : JSON.stringify(sourceCounts), destinationCounts == null ? null : JSON.stringify(destinationCounts), conflicts == null ? null : JSON.stringify(conflicts), error, finishedAt, id)).changes,
    }),
    operations: Object.freeze({
      create: async ({ id, ownerId = null, kind, status, stage, payload = null, error = null, createdAt, updatedAt = createdAt }) => await database.run(`
        INSERT INTO operations(id, owner_id, kind, status, stage, payload, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, id, ownerId, kind, status, stage, payload, error, createdAt, updatedAt),
      find: async (id) => {
        const row = await database.get("SELECT id, owner_id, kind, status, stage, payload, error, created_at, updated_at FROM operations WHERE id = ?", id);
        return row ? { ...row } : null;
      },
      update: async (id, { status, stage, error = null, updatedAt }) => (await database.run("UPDATE operations SET status = ?, stage = ?, error = ?, updated_at = ? WHERE id = ?", status, stage, error, updatedAt, id)).changes,
      updateWithPayload: async (id, { status, stage, payload, error = null, updatedAt }) => (await database.run("UPDATE operations SET status = ?, stage = ?, payload = ?, error = ?, updated_at = ? WHERE id = ?", status, stage, payload, error, updatedAt, id)).changes,
      listIncomplete: async () => (await database.all("SELECT id, owner_id, kind, status, stage, payload, error, created_at, updated_at FROM operations WHERE status NOT IN ('completed', 'cancelled') ORDER BY created_at, id")).map((row) => ({ ...row })),
      markRunningInterrupted: async (updatedAt) => (await database.run("UPDATE operations SET status = 'interrupted', error = COALESCE(error, 'server restarted during operation'), updated_at = ? WHERE status = 'running'", updatedAt)).changes,
    }),
  });
  let closed = false;
  let transactionOpen = false;
  let operationQueue = Promise.resolve();
  const transactionContext = new AsyncLocalStorage();

  function enqueue(work) {
    const result = operationQueue.then(() => {
      if (closed) throw new Error("application database is closed");
      return work();
    });
    operationQueue = result.catch(() => {});
    return result;
  }

  const repositories = Object.freeze(Object.fromEntries(Object.entries(rawRepositories).map(([name, repository]) => [
    name,
    Object.freeze(Object.fromEntries(Object.entries(repository).map(([method, operation]) => [
      method,
      (...args) => transactionContext.getStore() ? operation(...args) : enqueue(() => operation(...args)),
    ]))),
  ])));

  function transaction(work) {
    if (typeof work !== "function") throw new TypeError("application database transaction work must be a function");
    return enqueue(async () => {
      if (transactionOpen) throw new Error("nested application database transactions are not supported");
      transactionOpen = true;
      try {
        await database.exec("BEGIN IMMEDIATE");
        const result = await transactionContext.run(true, () => work(repositories));
        await database.exec("COMMIT");
        return result;
      } catch (error) {
        try { await database.exec("ROLLBACK"); } catch {}
        throw error;
      } finally {
        transactionOpen = false;
      }
    });
  }

  function reconcileInterruptedOperations(now = new Date().toISOString()) {
    return transaction((repositories) => repositories.operations.markRunningInterrupted(now));
  }

  function reconcileInterruptedRoutineRuns(now = new Date().toISOString()) {
    return transaction((repositories) => repositories.routines.interruptUnfinishedRuns(now));
  }

  async function hydrate() {
    if (closed) throw new Error("application database is closed");
    const [settings, hublots, incompleteOperations] = await Promise.all([
      repositories.settings.list(), repositories.hublots.list(), repositories.operations.listIncomplete(),
    ]);
    return Object.freeze({
      settings: Object.freeze(settings),
      hublots: Object.freeze(hublots),
      incompleteOperations: Object.freeze(incompleteOperations),
    });
  }

  function flush() {
    if (closed) return;
    return enqueue(() => database.exec("PRAGMA wal_checkpoint(PASSIVE)"));
  }

  return Object.freeze({
    path,
    repositories,
    migrationStatus,
    transaction,
    reconcileInterruptedOperations,
    reconcileInterruptedRoutineRuns,
    hydrate,
    flush,
    get closed() { return closed; },
    async close() {
      if (closed) return;
      await operationQueue;
      if (transactionOpen) throw new Error("cannot close application database during a transaction");
      closed = true;
      await database.close();
    },
  });
}
