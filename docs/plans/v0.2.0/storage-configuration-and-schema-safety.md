# Storage Configuration and Schema Safety

## Goal

Use one validated storage configuration for pi processes, JSONL catalogs,
SQLite catalogs, session references, and diagnostics. Protect Oyster-owned
SQLite files on disk and fail closed when an older binary encounters a newer or
inconsistent schema.

## Guardrails

- Resolve storage paths once in the stable server configuration and inject
  them. Catalog modules must not derive independent paths from `homedir()`.
- Keep JSONL and SQLite backends distinct. A configured session directory is not
  inferred differently by the launcher, catalog, codec, and deletion workflow.
- Preserve complete backend-neutral session references and confinement under the
  configured root.
- Do not chmod an arbitrary pre-existing shared parent directory. Create an
  Oyster-owned private directory or reject an unsafe layout with an actionable
  error.
- Database, WAL, and SHM files contain sensitive operational metadata and must
  be private.
- Never run an older migration set against a database whose ledger contains a
  newer version.
- Startup failures occur before listening or spawning runners.

## 1. Define One Session Storage Contract

- [ ] Add explicit stable config fields for `PI_AGENT_DIR`, the effective pi
  session directory, JSONL session root, and SQLite database path. Parse
  `--session-dir` once and reject missing values or conflicting duplicate args.
- [ ] Verify the exact `--session-dir` semantics against the configured local pi
  build with process-contract tests for both JSONL and SQLite.
- [ ] Include normalized storage fields in `--check-config` and authenticated
  diagnostics. Public health exposes only a backend/readiness label.
- [ ] Pass the same validated values to every long-lived and one-shot pi process
  through the centralized launcher.

**Acceptance:** configuration tests prove every process and catalog names the
same effective storage location.

## 2. Parameterize the JSONL Catalog and Codec

- [ ] Replace the hard-coded `~/.pi/agent/sessions` constant with
  `createJsonlSessionCatalog({ sessionsRoot })` and injected compatibility
  helpers.
- [ ] Build the selected catalog once from stable config and close/replace it
  only through an explicit lifecycle. Do not use a module-global default
  catalog in request workflows.
- [ ] Configure the session-reference codec with the same JSONL root and reject
  references outside it, including symlink escapes and references valid only
  under the old default root.
- [ ] Route list, search, read, fork, delete, checkpoint, permalink, and runner
  resume through the configured catalog.
- [ ] Add non-default-root integration tests proving pi-created sessions appear,
  resume, fork, checkpoint, search, and delete from the configured location and
  never touch the default directory.

**Acceptance:** `PI_CODING_AGENT_DIR` and `--session-dir` cannot make pi write to
one location while Oyster reads or deletes another.

## 3. Enforce Private Application Database Files

- [ ] Define an Oyster-owned application-data directory contract. Create a
  missing directory with mode `0700`; reject symlinked, non-directory, or
  insecure custom layouts unless an explicit, documented deployment policy
  proves equivalent isolation.
- [ ] Create/open the application database with mode `0600` and enforce `0600`
  on the database, `-wal`, and `-shm` files after SQLite creates them.
- [ ] Validate file type, owner, and permissions before migration. Fail closed
  rather than following a replaced symlink.
- [ ] Recheck sidecar permissions after checkpoint/reopen and document backup
  handling for WAL mode.
- [ ] Add temporary-directory tests with permissive umasks, existing insecure
  files, custom paths, sidecar creation, restart, and failure cleanup.

**Acceptance:** no Oyster-owned database artifact is group/world-readable under
a permissive process umask.

## 4. Reject Newer or Inconsistent Schemas

- [ ] Compare the highest ledger version with the highest migration known to the
  binary before applying anything. Reject any newer version with a downgrade
  error that names versions but not sensitive paths.
- [ ] Reject unknown gaps, duplicate/name mismatches, non-integer versions, and a
  ledger claiming a migration whose expected schema invariant is absent.
- [ ] Report the actual highest applied version rather than always reporting the
  code's latest version.
- [ ] Keep each migration atomic and verify rollback leaves both schema and
  ledger unchanged.
- [ ] Add forward-version, downgrade, corrupt-ledger, partial-schema, and normal
  upgrade tests; server startup must not listen after any rejection.

**Acceptance:** an older Oyster binary cannot silently operate on a newer
application database.

## 5. Add Integrity and Recovery Operations

- [ ] Run bounded startup checks appropriate to database size (`quick_check`,
  foreign-key check, migration invariants) before hydrating repositories.
- [ ] Add an authenticated diagnostic or offline command for full integrity
  checks, orphan ownership records, interrupted operations, and sidecar state.
- [ ] Document online backup, stopped-service backup including WAL/SHM,
  restore-version matching, and downgrade prohibition.
- [ ] Ensure a failed integrity check preserves all files and starts no runner,
  routine, hublot, migration, or HTTP listener.
- [ ] Add backup/restore tests using temporary databases across supported schema
  versions.

**Acceptance:** operators receive a fail-closed, actionable diagnosis without an
automatic destructive repair.

## 6. Complete Compatibility Validation

- [ ] Run JSONL and SQLite process contracts under default agent storage,
  alternate agent directories, explicit session directories, and custom app DB
  paths.
- [ ] Extend static guards to reject new catalog-level `homedir()` defaults,
  hard-coded session roots, direct database opens, and narrowed SQLite identity
  comparisons.
- [ ] Update configuration, installation, systemd, Docker, backup, and rollback
  documentation.
- [ ] Run unit, build, Docker, server-restart, and browser persistence e2e tests.

## Completion criteria

- One stable config determines all pi and Oyster session paths.
- JSONL works fully outside `~/.pi/agent/sessions`.
- Application database files and sidecars are private and non-symlinked.
- Newer, inconsistent, or corrupt schemas fail before service startup.
- Backup, restore, integrity, and rollback behavior is documented and tested.
