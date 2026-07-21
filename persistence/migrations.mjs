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
]);

function validateMigrations(migrations) {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= previous) {
      throw new Error("application database migrations must have unique ascending integer versions");
    }
    if (!migration.name || !migration.sql) throw new Error(`invalid application database migration ${migration.version}`);
    previous = migration.version;
  }
}

/** Apply each pending migration atomically and return the resulting status. */
export function applyMigrations(database, { migrations = APP_MIGRATIONS, now = () => new Date().toISOString() } = {}) {
  validateMigrations(migrations);
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = database.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all();
  const applied = new Map(appliedRows.map((row) => [Number(row.version), row.name]));
  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      if (applied.get(migration.version) !== migration.name) {
        throw new Error(`application database migration ${migration.version} name mismatch`);
      }
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, now());
      database.exec("COMMIT");
      applied.set(migration.version, migration.name);
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      throw new Error(`application database migration ${migration.version} (${migration.name}) failed: ${error.message}`, { cause: error });
    }
  }

  return Object.freeze({
    currentVersion: migrations.at(-1)?.version ?? 0,
    appliedVersions: Object.freeze([...applied.keys()].sort((a, b) => a - b)),
  });
}
