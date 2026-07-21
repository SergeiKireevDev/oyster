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
