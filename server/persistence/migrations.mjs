export const APP_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: "foundation",
    sql: `
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;

      CREATE TABLE operations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        payload TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;

      CREATE INDEX operations_status_kind_idx ON operations(status, kind);
    `,
  }),
  Object.freeze({
    version: 2,
    name: "session_ownership",
    sql: `
      CREATE TABLE app_sessions (
        id INTEGER PRIMARY KEY,
        backend TEXT NOT NULL,
        session_id TEXT NOT NULL,
        storage_path TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (backend, session_id, storage_path)
      );

      CREATE UNIQUE INDEX app_sessions_identity_without_path_idx
        ON app_sessions(backend, session_id) WHERE storage_path IS NULL;

      ALTER TABLE operations ADD COLUMN owner_id INTEGER
        REFERENCES app_sessions(id) ON DELETE SET NULL;
      CREATE INDEX operations_owner_idx ON operations(owner_id);
    `,
  }),
  Object.freeze({
    version: 3,
    name: "session_deletion_state",
    sql: `
      ALTER TABLE app_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'deleting'));
      CREATE INDEX app_sessions_status_idx ON app_sessions(status);
    `,
  }),
  Object.freeze({
    version: 4,
    name: "checkpoints",
    sql: `
      CREATE TABLE checkpoints (
        id INTEGER PRIMARY KEY,
        owner_id INTEGER NOT NULL REFERENCES app_sessions(id) ON DELETE CASCADE,
        git_hash TEXT NOT NULL,
        anchor_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(owner_id, git_hash, anchor_id)
      );
      CREATE INDEX checkpoints_owner_created_idx ON checkpoints(owner_id, created_at, id);
    `,
  }),
  Object.freeze({
    version: 5,
    name: "routines",
    sql: `
      CREATE TABLE routines (
        id TEXT PRIMARY KEY,
        owner_id INTEGER REFERENCES app_sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL UNIQUE,
        script TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        cwd TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;

      CREATE TABLE routine_runs (
        id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK (mode IN ('run', 'teardown')),
        status TEXT NOT NULL,
        progress INTEGER CHECK (progress BETWEEN 0 AND 100),
        message TEXT,
        result TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        exit_code INTEGER,
        error TEXT
      ) WITHOUT ROWID;

      CREATE TABLE routine_log_lines (
        run_id TEXT NOT NULL REFERENCES routine_runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        stream TEXT NOT NULL CHECK (stream IN ('stdout', 'stderr')),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence)
      ) WITHOUT ROWID;

      CREATE INDEX routines_owner_idx ON routines(owner_id);
      CREATE INDEX routine_runs_routine_started_idx ON routine_runs(routine_id, started_at);
    `,
  }),
  Object.freeze({
    version: 6,
    name: "hublots",
    sql: `
      CREATE TABLE hublots (
        id TEXT PRIMARY KEY,
        owner_id INTEGER REFERENCES app_sessions(id) ON DELETE CASCADE,
        port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
        label TEXT,
        brief TEXT,
        workdir TEXT NOT NULL,
        service_kind TEXT NOT NULL CHECK (service_kind IN ('agent_managed', 'self_served')),
        service_start_script_path TEXT,
        service_start_script TEXT,
        service_start_script_sha256 TEXT,
        public_url TEXT,
        status TEXT NOT NULL,
        desired_state TEXT NOT NULL CHECK (desired_state IN ('open', 'closed')),
        restart_count INTEGER NOT NULL DEFAULT 0 CHECK (restart_count >= 0),
        next_restart_at TEXT,
        created_at TEXT NOT NULL,
        opened_at TEXT,
        closed_at TEXT,
        last_error TEXT
      ) WITHOUT ROWID;

      CREATE TABLE hublot_processes (
        id TEXT PRIMARY KEY,
        hublot_id TEXT NOT NULL REFERENCES hublots(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('service', 'tunnel', 'setup_agent')),
        pid INTEGER NOT NULL CHECK (pid > 0),
        process_group_id INTEGER,
        boot_id TEXT,
        proc_start_ticks TEXT,
        executable TEXT,
        command_sha256 TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        observed_at TEXT,
        ended_at TEXT,
        exit_code INTEGER,
        signal TEXT
      ) WITHOUT ROWID;

      CREATE TABLE hublot_lifecycle_events (
        hublot_id TEXT NOT NULL REFERENCES hublots(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL,
        desired_state TEXT NOT NULL CHECK (desired_state IN ('open', 'closed')),
        public_url TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (hublot_id, sequence)
      ) WITHOUT ROWID;

      CREATE INDEX hublots_owner_idx ON hublots(owner_id);
      CREATE INDEX hublots_desired_status_idx ON hublots(desired_state, status);
      CREATE INDEX hublot_processes_hublot_role_idx ON hublot_processes(hublot_id, role, status);
    `,
  }),
  Object.freeze({
    version: 7,
    name: "hublot_port_allocation",
    sql: `
      CREATE UNIQUE INDEX hublots_active_port_idx ON hublots(port) WHERE status <> 'closed';
    `,
  }),
  Object.freeze({
    version: 8,
    name: "runner_descriptors",
    sql: `
      CREATE TABLE runners (
        id TEXT PRIMARY KEY,
        owner_id INTEGER REFERENCES app_sessions(id) ON DELETE CASCADE,
        dir TEXT NOT NULL,
        session_backend TEXT,
        session_id TEXT,
        session_storage_path TEXT,
        session_name TEXT,
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        desired_state TEXT NOT NULL CHECK (desired_state IN ('running', 'stopped')),
        last_status TEXT NOT NULL CHECK (last_status IN ('starting', 'running', 'stopped', 'dead', 'interrupted')),
        start_count INTEGER NOT NULL DEFAULT 0 CHECK (start_count >= 0),
        created_at TEXT NOT NULL,
        last_started_at TEXT,
        last_stopped_at TEXT,
        CHECK ((session_backend IS NULL AND session_id IS NULL AND session_storage_path IS NULL)
          OR (session_backend IS NOT NULL AND session_id IS NOT NULL))
      ) WITHOUT ROWID;
      CREATE INDEX runners_owner_idx ON runners(owner_id);
      CREATE INDEX runners_session_idx ON runners(session_backend, session_id, session_storage_path);
      CREATE UNIQUE INDEX runners_one_default_idx ON runners(is_default) WHERE is_default = 1;
    `,
  }),
  Object.freeze({
    version: 9,
    name: "runner_replay_events",
    sql: `
      CREATE TABLE runner_events (
        runner_id TEXT NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        sse_id TEXT,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (runner_id, sequence)
      ) WITHOUT ROWID;
      CREATE UNIQUE INDEX runner_events_sse_id_idx ON runner_events(runner_id, sse_id) WHERE sse_id IS NOT NULL;
    `,
  }),
  Object.freeze({
    version: 10,
    name: "legacy_migration_ledger",
    sql: `
      CREATE TABLE legacy_migration_ledger (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK (mode IN ('dry-run', 'apply')),
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
        source_counts TEXT,
        destination_counts TEXT,
        conflicts TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      ) WITHOUT ROWID;
      CREATE INDEX legacy_migration_ledger_started_idx ON legacy_migration_ledger(started_at, id);
    `,
  }),
  Object.freeze({
    version: 11,
    name: "session_archiving",
    sql: `
      ALTER TABLE app_sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
        CHECK (archived IN (0, 1));
      CREATE INDEX app_sessions_archived_idx ON app_sessions(archived);
    `,
  }),
  Object.freeze({
    version: 12,
    name: "pinned_widgets",
    sql: `
      CREATE TABLE pinned_widget_groups (
        id TEXT PRIMARY KEY,
        owner_id INTEGER REFERENCES app_sessions(id) ON DELETE CASCADE,
        scope TEXT NOT NULL CHECK (scope IN ('session', 'workspace')),
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
        position INTEGER NOT NULL CHECK (position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((scope = 'workspace' AND owner_id IS NULL) OR (scope = 'session' AND owner_id IS NOT NULL))
      ) WITHOUT ROWID;

      CREATE TABLE pinned_widgets (
        id TEXT PRIMARY KEY,
        owner_id INTEGER REFERENCES app_sessions(id) ON DELETE CASCADE,
        scope TEXT NOT NULL CHECK (scope IN ('session', 'workspace')),
        group_id TEXT REFERENCES pinned_widget_groups(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK (kind IN (
          'live_interface', 'image', 'video', 'markdown', 'file', 'directory', 'builtin', 'link'
        )),
        label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 200),
        position INTEGER NOT NULL CHECK (position >= 0),
        target TEXT,
        hublot_id TEXT REFERENCES hublots(id) ON DELETE SET NULL,
        mime_type TEXT,
        size INTEGER CHECK (size IS NULL OR size >= 0),
        mtime_ms INTEGER CHECK (mtime_ms IS NULL OR mtime_ms >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((scope = 'workspace' AND owner_id IS NULL) OR (scope = 'session' AND owner_id IS NOT NULL)),
        CHECK (kind = 'live_interface' OR hublot_id IS NULL),
        CHECK ((kind IN ('image', 'video', 'markdown', 'file', 'directory', 'link') AND target IS NOT NULL)
          OR (kind IN ('live_interface', 'builtin')))
      ) WITHOUT ROWID;

      CREATE INDEX pinned_widget_groups_scope_position_idx
        ON pinned_widget_groups(scope, owner_id, position, id);
      CREATE INDEX pinned_widgets_scope_group_position_idx
        ON pinned_widgets(scope, owner_id, group_id, position, id);
      CREATE UNIQUE INDEX pinned_widgets_hublot_idx
        ON pinned_widgets(hublot_id) WHERE hublot_id IS NOT NULL;
      CREATE UNIQUE INDEX pinned_widgets_builtin_workspace_idx
        ON pinned_widgets(target) WHERE kind = 'builtin' AND scope = 'workspace';

      INSERT INTO pinned_widgets(
        id, owner_id, scope, group_id, kind, label, position, target, hublot_id,
        mime_type, size, mtime_ms, created_at, updated_at
      ) VALUES (
        'builtin:file-explorer', NULL, 'workspace', NULL, 'builtin',
        'Files', 0, 'file-explorer', NULL, NULL, NULL, NULL,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );

      INSERT OR IGNORE INTO pinned_widgets(
        id, owner_id, scope, group_id, kind, label, position, target, hublot_id,
        mime_type, size, mtime_ms, created_at, updated_at
      )
      SELECT 'hublot:' || id, owner_id,
        CASE WHEN owner_id IS NULL THEN 'workspace' ELSE 'session' END,
        NULL, 'live_interface', COALESCE(NULLIF(trim(label), ''), 'Live interface'),
        1000 + row_number() OVER (ORDER BY created_at, id), NULL, id,
        NULL, NULL, NULL, created_at, created_at
      FROM hublots
      WHERE desired_state = 'open' OR status <> 'closed';
    `,
  }),
  Object.freeze({
    version: 13,
    name: "browser_video_containers",
    sql: `
      UPDATE pinned_widgets
      SET kind = 'video',
          mime_type = CASE
            WHEN lower(target) LIKE '%.avi' THEN 'video/x-msvideo'
            WHEN lower(target) LIKE '%.mkv' THEN 'video/x-matroska'
          END,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE kind = 'file'
        AND (lower(target) LIKE '%.avi' OR lower(target) LIKE '%.mkv');
    `,
  }),
  Object.freeze({
    version: 14,
    name: "svg_media",
    sql: `
      UPDATE pinned_widgets
      SET kind = 'image',
          mime_type = 'image/svg+xml',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE kind = 'file' AND lower(target) LIKE '%.svg';
    `,
  }),
  Object.freeze({
    version: 15,
    name: "monitoring_widgets",
    sql: `
      CREATE TABLE pinned_widgets_next (
        id TEXT PRIMARY KEY,
        owner_id INTEGER REFERENCES app_sessions(id) ON DELETE CASCADE,
        scope TEXT NOT NULL CHECK (scope IN ('session', 'workspace')),
        group_id TEXT REFERENCES pinned_widget_groups(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK (kind IN (
          'live_interface', 'image', 'video', 'markdown', 'file', 'directory', 'builtin', 'link', 'monitoring'
        )),
        label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 200),
        position INTEGER NOT NULL CHECK (position >= 0),
        target TEXT,
        hublot_id TEXT REFERENCES hublots(id) ON DELETE SET NULL,
        mime_type TEXT,
        size INTEGER CHECK (size IS NULL OR size >= 0),
        mtime_ms INTEGER CHECK (mtime_ms IS NULL OR mtime_ms >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((scope = 'workspace' AND owner_id IS NULL) OR (scope = 'session' AND owner_id IS NOT NULL)),
        CHECK (kind = 'live_interface' OR hublot_id IS NULL),
        CHECK ((kind IN ('image', 'video', 'markdown', 'file', 'directory', 'link', 'monitoring') AND target IS NOT NULL)
          OR (kind IN ('live_interface', 'builtin')))
      ) WITHOUT ROWID;

      INSERT INTO pinned_widgets_next SELECT * FROM pinned_widgets;
      DROP TABLE pinned_widgets;
      ALTER TABLE pinned_widgets_next RENAME TO pinned_widgets;

      CREATE INDEX pinned_widgets_scope_group_position_idx
        ON pinned_widgets(scope, owner_id, group_id, position, id);
      CREATE UNIQUE INDEX pinned_widgets_hublot_idx
        ON pinned_widgets(hublot_id) WHERE hublot_id IS NOT NULL;
      CREATE UNIQUE INDEX pinned_widgets_builtin_workspace_idx
        ON pinned_widgets(target) WHERE kind = 'builtin' AND scope = 'workspace';
    `,
  }),
]);

function validateMigrations(migrations) {
  if (!Array.isArray(migrations)) throw new TypeError("application database migrations must be an array");

  let previous = 0;
  for (const migration of migrations) {
    if (!migration || !Number.isSafeInteger(migration.version) || migration.version <= previous) {
      throw new Error("application database migrations must have unique ascending integer versions greater than zero");
    }
    if (typeof migration.name !== "string" || !migration.name.trim()
      || typeof migration.sql !== "string" || !migration.sql.trim()) {
      throw new Error(`invalid application database migration ${migration.version}`);
    }
    previous = migration.version;
  }
}

const queryAll = (database, sql, ...params) => database.all
  ? database.all(sql, ...params)
  : database.prepare(sql).all(...params);
const queryGet = (database, sql, ...params) => database.get
  ? database.get(sql, ...params)
  : database.prepare(sql).get(...params);
const executeRun = (database, sql, ...params) => database.run
  ? database.run(sql, ...params)
  : database.prepare(sql).run(...params);

async function readAppliedMigrations(database, migrations) {
  const configured = new Map(migrations.map((migration) => [migration.version, migration.name]));
  const applied = new Map();
  for (const row of await queryAll(database, "SELECT version, name FROM schema_migrations ORDER BY version")) {
    const version = Number(row.version);
    if (!Number.isSafeInteger(version) || version < 1 || typeof row.name !== "string") {
      throw new Error("application database migration history is invalid");
    }
    if (!configured.has(version)) {
      throw new Error(`application database migration ${version} is not supported by this server`);
    }
    if (configured.get(version) !== row.name) {
      throw new Error(`application database migration ${version} name mismatch`);
    }
    applied.set(version, row.name);
  }

  let foundPending = false;
  for (const migration of migrations) {
    if (!applied.has(migration.version)) foundPending = true;
    else if (foundPending) throw new Error("application database migration history has a gap");
  }
  return applied;
}

function migrationError(migration, error, rollbackError) {
  const detail = error instanceof Error ? error.message : String(error);
  const message = `application database migration ${migration.version} (${migration.name}) failed: ${detail}`;
  return rollbackError
    ? new AggregateError([error, rollbackError], `${message}; rollback failed`, { cause: error })
    : new Error(message, { cause: error });
}

/** Apply each pending migration atomically and return the resulting status. */
export async function applyMigrations(database, { migrations = APP_MIGRATIONS, now = () => new Date().toISOString() } = {}) {
  if (!database || typeof database.exec !== "function"
      || (!(typeof database.get === "function" && typeof database.all === "function" && typeof database.run === "function")
        && typeof database.prepare !== "function")) {
    throw new TypeError("application database connection is required");
  }
  if (database.isTransaction) throw new Error("cannot apply application database migrations inside a transaction");
  if (typeof now !== "function") throw new TypeError("application database migration clock must be a function");
  validateMigrations(migrations);

  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const initiallyApplied = await readAppliedMigrations(database, migrations);

  for (const migration of migrations) {
    if (initiallyApplied.has(migration.version)) continue;
    await database.exec("BEGIN IMMEDIATE");
    try {
      // Recheck while holding the write lock: another server may have applied
      // this migration after the initial history read.
      const existing = await queryGet(database, "SELECT name FROM schema_migrations WHERE version = ?", migration.version);
      if (existing) {
        if (existing.name !== migration.name) {
          throw new Error(`application database migration ${migration.version} name mismatch`);
        }
      } else {
        const appliedAt = now();
        if (typeof appliedAt !== "string" || !appliedAt.trim()) {
          throw new TypeError("application database migration clock must return a timestamp string");
        }
        await database.exec(migration.sql);
        await executeRun(database, "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)", migration.version, migration.name, appliedAt);
      }
      await database.exec("COMMIT");
    } catch (error) {
      let rollbackError;
      try { await database.exec("ROLLBACK"); } catch (caught) { rollbackError = caught; }
      throw migrationError(migration, error, rollbackError);
    }
  }

  const applied = await readAppliedMigrations(database, migrations);
  return Object.freeze({
    currentVersion: migrations.at(-1)?.version ?? 0,
    appliedVersions: Object.freeze([...applied.keys()]),
  });
}
