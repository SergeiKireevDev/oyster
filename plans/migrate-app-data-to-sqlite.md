# Migrate pi-lot-ui Application Data to SQLite

## Goal

Make SQLite authoritative for all pi-lot-ui-owned durable data, including checkpoints, routines, hublots, runner descriptors, replay events, and server-level settings.

Keep the app database separate from the coding agent's session database:

```text
~/.pi/agent/pi-lot-ui.sqlite
```

The coding agent continues to own `sessions.sqlite` (or JSONL in compatibility mode). pi-lot-ui must not add tables to or directly mutate the agent's SQLite schema.

## Coding-agent SQLite boundary

The pi agent SQLite model must remain unchanged throughout this migration.

- Do not add or alter agent tables, columns, indexes, triggers, migrations, or metadata formats.
- Do not attach the agent database to the app database for cross-database writes or foreign keys.
- Continue reading sessions through the backend-neutral catalog.
- Continue creating forks and deleting sessions through the coding agent's supported repository operations.
- Treat the agent's `sessions.parent_session_id`, entries, and active leaf as canonical session lineage.
- Store only pi-lot-ui-owned resource ownership, checkpoint associations, and recovery metadata in `pi-lot-ui.sqlite`.
- Any app-side parent or fork-point fields must be optional denormalized metadata for app workflows, never a replacement for or mutation of the agent model.

## Runtime boundary

No authoritative app data may live only in memory. Memory may contain only active OS/runtime handles and rebuildable caches:

- runner, routine, cloudflared, hublot-agent, and service process handles
- SSE responses, readline streams, timers, and pending command queues
- maps from persistent IDs to live handles
- short-lived auth throttling and derived caches

Process metadata, lifecycle status, logs, resource ownership, and replay events must be persisted in SQLite.

## State inventory and persistence policy

Every current stable-state field must be classified before migration so “all app state” has an explicit disposition:

| State | SQLite authority | In-memory remainder |
|---|---|---|
| `currentDir`, default runner selection, app preferences | `app_settings` | read-through cache only |
| runner identity, session binding, lifecycle, bounded replay | `runners`, `runner_events` | child process, stdin/stdout, resume queue, watchdog timers |
| routine definition/binding, revisions, runs, progress, logs | routine tables | active process and stream readers |
| hublot definition/binding, desired and observed state, URL, process identity, recovery history | hublot tables | verified live `ChildProcess` handles and supervisor timers |
| checkpoints and rollback workflow | checkpoint and operation tables | derived tree caches only |
| cross-store/OS workflows | `operations` journal | currently executing promise/controller |
| session catalog data | coding-agent store remains authoritative | rebuildable read-only catalog/cache |
| configuration such as executable paths and backend selection | startup flags/environment remain authoritative unless explicitly user-mutable | validated immutable config |
| auth token, active SSE responses, request throttles, reload counters, timers | deliberately not persisted | ephemeral/security-sensitive state only |

Global one-shot SSE notifications are not replayed because stale toasts and lifecycle events are unsafe. Durable domain changes behind those notifications are persisted and reconstructed through list/state endpoints; per-runner output retains bounded durable replay.

## Session ownership and cascade deletion

All session-owned app resources must be cascade deleted when their owning session is deleted:

- checkpoints
- routine definitions, bindings, run history, and logs
- hublot records and lifecycle history

Use an app-local session ownership table. Resource tables reference it with `ON DELETE CASCADE`:

```sql
CREATE TABLE app_sessions (
  id INTEGER PRIMARY KEY,
  backend TEXT NOT NULL,
  session_id TEXT NOT NULL,
  storage_path TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (backend, session_id, storage_path)
);

-- Representative ownership columns:
owner_id INTEGER REFERENCES app_sessions(id) ON DELETE CASCADE
```

`owner_id` is required for a session-bound resource and nullable only for resources whose existing API explicitly permits a global/released state. Rebinding must update ownership transactionally; clearing ownership must be an explicit release operation, never a side effect of session deletion.

Routine runs and logs cascade through their routine. Hublot runtime handles are removed separately because SQLite cannot manage OS processes.

Deleting a session-owned routine means deleting its definition and history, not merely releasing its binding. Routine-created external byproducts are not automatically removed unless a separate policy explicitly requires running the routine's teardown protocol during session deletion.

Deleting a fork removes only resources owned by that fork. It must not delete resources owned by an ancestor session.

Because agent sessions and app resources live in separate stores, deletion is a durable, recoverable workflow rather than a cross-database transaction:

1. Persist a `delete_session` operation and mark the session as deleting.
2. Stop matching runner processes.
3. Close owned hublots and terminate their managed services.
4. Stop owned routines.
5. Delete the session through the configured agent backend.
6. Delete the corresponding `app_sessions` row in one app-database transaction, triggering all resource cascades.
7. Remove runtime handles and broadcast resource/session updates.
8. Mark the deletion operation complete.

A failure before agent deletion must preserve all database records. If the process stops after agent deletion, startup reconciliation must detect the durable operation and complete the app-resource cascade. Resource cleanup must therefore be eventually complete despite crashes between stores or OS operations.

## Proposed schema

The exact DDL may evolve during implementation, but the domain boundaries and ownership constraints are required.

### Schema management

```sql
schema_migrations(version, applied_at)
app_settings(key PRIMARY KEY, value, updated_at)
operations(id, kind, status, stage, payload, error, created_at, updated_at)
```

`operations` journals workflows that cross SQLite, Git, the coding-agent store, or OS processes.

### Checkpoints

```sql
checkpoints(
  id,
  owner_id REFERENCES app_sessions(id) ON DELETE CASCADE,
  git_hash,
  anchor_id,
  leaf_id,
  cwd,
  message,
  created_at,
  UNIQUE(owner_id, git_hash, anchor_id)
)
```

Initially preserve existing fork inheritance behavior. A normalized inheritance model may be introduced only if checkpoint-tree and rollback semantics remain unchanged.

### Routines

```sql
routines(
  id,
  owner_id REFERENCES app_sessions(id) ON DELETE CASCADE,
  name UNIQUE,
  script,
  revision,
  cwd,
  created_at,
  updated_at
)

routine_runs(
  id,
  routine_id REFERENCES routines(id) ON DELETE CASCADE,
  mode,
  status,
  progress,
  message,
  started_at,
  finished_at,
  exit_code,
  error
)

routine_log_lines(
  run_id REFERENCES routine_runs(id) ON DELETE CASCADE,
  sequence,
  stream,
  text,
  created_at
)
```

Routine scripts are materialized atomically into a private runtime directory before execution. Materialized files are disposable execution artifacts, not authoritative data.

### Hublots

```sql
hublots(
  id,
  owner_id REFERENCES app_sessions(id) ON DELETE CASCADE,
  port,
  label,
  brief,
  workdir,
  service_kind,                 -- agent_managed / self_served
  service_start_script_path,
  service_start_script,
  service_start_script_sha256,
  public_url,
  status,
  desired_state,
  restart_count,
  next_restart_at,
  created_at,
  opened_at,
  closed_at,
  last_error
)

hublot_processes(
  id,
  hublot_id REFERENCES hublots(id) ON DELETE CASCADE,
  role,                         -- service / tunnel / setup_agent
  pid,
  process_group_id,
  boot_id,
  proc_start_ticks,
  executable,
  command_sha256,
  status,
  started_at,
  observed_at,
  ended_at,
  exit_code,
  signal
)
```

Every service, cloudflared tunnel, and setup-agent PID must be written to `hublot_processes` as soon as it is spawned or discovered. A PID alone is never sufficient proof of ownership: `boot_id`, `/proc` start ticks, executable, and command fingerprint must be persisted where available and checked before signaling or adopting a process after restart. Stale public URLs must never be advertised as open.

For agent-managed hublots, creation must allocate a durable startup-script path under an app-controlled hublot directory before asking the setup agent to prepare the service. The setup agent must create an idempotent executable at that exact path and use it to start the service. After creation, the app stores both the path and validated script contents/hash in SQLite; the file is a materialization and can be restored from SQLite if missing. Self-served hublots have no app-owned startup script unless the caller explicitly supplies one.

Hublot rows and their desired state must survive `server.mjs` replacement. A manually closed hublot has `desired_state = 'closed'`; an open hublot retains `desired_state = 'open'` across planned restarts and crashes. Startup reconciliation must recover or accurately mark every such row instead of returning an empty hublot list.

For an open hublot after restart or during periodic supervision:

- reconcile every persisted process row against the OS using its full process identity;
- discard the old public URL until cloudflared is confirmed or replaced;
- identify and clean up an orphaned cloudflared process only when its persisted process identity can be verified;
- if cloudflared is dead but the service answers, open a replacement tunnel and persist its PID and new URL;
- if an agent-managed service is dead, rematerialize and execute its persisted startup script in the persisted workdir, verify the port, persist the new service PID, and then reopen the tunnel;
- apply bounded exponential backoff and a crash-loop limit to automatic service or tunnel restarts;
- if a self-served service without a startup script is gone, mark the hublot `interrupted` with an actionable error rather than pretending it is open;
- broadcast the reconciled state and URL to clients.

Graceful shutdown must preserve the row and desired state, wait for managed processes to exit (with bounded SIGTERM/SIGKILL escalation), and must not rely on delayed timers after `process.exit()`.

### Runners and replay

```sql
runners(
  id,
  owner_id REFERENCES app_sessions(id) ON DELETE CASCADE,
  dir,
  session_backend,
  session_id,
  session_storage_path,
  session_name,
  desired_state,
  last_status,
  start_count,
  created_at,
  last_started_at,
  last_stopped_at
)

runner_events(
  runner_id REFERENCES runners(id) ON DELETE CASCADE,
  sequence,
  sse_id,
  payload,
  created_at
)
```

Runner descriptors survive restarts. Runner processes remain in memory and restart lazily when selected. Replay events are capped in SQLite to preserve the current bounded-buffer behavior.

## Implementation plan

### 1. Add the app database foundation

- [x] Add `PI_UI_DB_PATH`, defaulting to `~/.pi/agent/pi-lot-ui.sqlite`.
- [x] Create one stable-core-owned database service and expose repositories through `state.appStore`; define deterministic startup, hot-reload reuse, graceful close, and test teardown behavior.
- [x] Enable WAL, foreign keys, a busy timeout, and `synchronous=NORMAL`.
- [x] Add numbered, transactional, idempotent schema migrations.
- [ ] Set and document the universal Node version required by `node:sqlite`.
- [ ] Add tests for migrations, constraints, transactions, restart behavior, and concurrent WAL access.
- [ ] Add a static/integration guard proving app migrations and writes target only `pi-lot-ui.sqlite` and leave the coding-agent schema unchanged.

### 2. Wire the app store into the stable server core

- [ ] Resolve and validate `PI_UI_DB_PATH` in `server.mjs`, include the non-secret resolved path and migration status in startup logging and `/health`, and fail startup before listening when the store cannot be opened or migrated.
- [ ] Open exactly one app-store instance during stable-core startup, assign it to `state.appStore` before the first `app.mjs` load, and reuse that same instance across every hot reload.
- [ ] Define a narrow app-store interface containing repositories and transaction/close operations; inject it from `state` into runner, checkpoint, routine, hublot, session, and settings composition instead of opening SQLite connections inside route modules or domain modules.
- [ ] Add startup hydration that reconstructs rebuildable in-memory indexes and runtime registries from the store without spawning runners, routines, services, or tunnels prematurely.
- [ ] Add startup reconciliation ordering: migrations first, then interrupted operation recovery, then domain hydration, and only then accept HTTP requests and broadcast reconciled state.
- [ ] Make graceful shutdown stop accepting new work, await bounded runner/routine/hublot cleanup, flush pending repository writes, checkpoint/close the app store once, and remain idempotent across signals and test teardown.
- [ ] Add integration tests proving hot reload preserves the same store instance, full server restart restores durable state, startup migration failure does not bind the HTTP port, and shutdown closes the store without use-after-close callbacks.
- [ ] Add an architecture guard forbidding direct `node:sqlite` construction outside the app-store persistence layer and the existing read-only coding-agent session catalog.

### 3. Add session ownership and deletion orchestration

- [ ] Add `app_sessions`, ownership foreign keys, and durable operation journaling.
- [ ] Upsert an app-session owner whenever a session-owned resource is created.
- [ ] Implement the staged session deletion workflow described above.
- [ ] Reconcile incomplete deletion operations at startup.
- [ ] Ensure session deletion deletes owned routines rather than releasing them.
- [ ] Preserve all resources when agent-session deletion fails.
- [ ] Add cross-session, global/released-resource, rebinding, and fork-isolation tests for every resource type.

### 4. Migrate checkpoints

- [ ] Replace `loadCheckpoints()` and `saveCheckpoints()` with a checkpoint repository.
- [ ] Make recording, lookup, tree assembly, and fork inheritance repository-based.
- [ ] Journal rollback stages because Git and agent session operations cannot share the app transaction.
- [ ] Add an idempotent importer for `~/.pi/agent/checkpoints.json`.
- [ ] Preserve current checkpoint HTTP payloads and rollback behavior.
- [ ] Verify checkpoint rows cascade when their owner session is deleted.

### 5. Migrate routines

- [ ] Store routine definitions, ownership, scripts, bindings, runs, progress, results, and capped logs in SQLite.
- [ ] Replace routine directory scanning and `bindings.json` as authoritative stores.
- [ ] Materialize scripts securely and atomically for `run` and `teardown`.
- [ ] Keep only process handles and stream readers in memory.
- [ ] Mark unfinished runs as interrupted during startup reconciliation.
- [ ] Import existing executable routine files and bindings idempotently.
- [ ] Preserve current routes, SSE events, extension behavior, and session scoping.
- [ ] Verify definition, runs, logs, and runtime handles are removed on session deletion.

### 6. Migrate and persist hublots

- [ ] Make SQLite authoritative for hublot identity, configuration, ownership, brief, workdir, startup script, desired state, observed state, URL, errors, processes, restart state, and lifecycle history.
- [ ] Persist a hublot row and its allocated startup-script path before starting its setup agent or tunnel process.
- [ ] Require the setup agent to create and invoke an idempotent startup script at the allocated path; validate and store its contents and SHA-256 in SQLite.
- [ ] Rematerialize a missing or mismatched startup script from SQLite before invoking it.
- [ ] Persist the PID and verifiable process identity of every service, cloudflared tunnel, and setup agent immediately after spawn or discovery.
- [ ] Record transitions through `opening`, `open`, `recovering`, `closing`, `closed`, `failed`, and `interrupted`.
- [ ] Persist session rebinding and process metadata updates transactionally.
- [ ] Keep only `ChildProcess` handles in an in-memory registry keyed by persistent process/hublot ID.
- [ ] Replace `state.nextHublotPort` with transactional allocation plus a live port check.
- [ ] Add a supervisor that periodically reconciles desired-open hublots and their persisted process identities.
- [ ] On startup, load persisted hublots and reconcile every row whose desired state is open.
- [ ] Restart dead services from the persisted startup script, verify the port, and persist the replacement PID before reopening their tunnels.
- [ ] Recover an answering local service by opening a replacement tunnel and persisting its process identity and new URL.
- [ ] Use bounded exponential backoff and crash-loop protection for automatic restarts.
- [ ] Mark a missing self-served service without a startup script interrupted.
- [ ] Never publish a persisted URL until its current cloudflared process is confirmed healthy.
- [ ] Make graceful shutdown await bounded process cleanup while retaining desired state for restart recovery.
- [ ] Preserve current routes, SSE events, tool behavior, and stable hublot IDs across restarts.
- [ ] Verify session deletion closes the service and tunnel before cascading its database and startup-script records.

### 7. Persist runner descriptors and replay events

- [ ] Use stable runner IDs suitable for persistence.
- [ ] Persist runner directory, session reference, name, selected/default state, and lifecycle metadata.
- [ ] Replace the in-memory replay buffer with a bounded `runner_events` repository.
- [ ] Restore descriptors on startup but spawn processes only on demand.
- [ ] Mark previously live runners as interrupted/stopped after restart.
- [ ] Keep process handles, watchdog state, resume queues, timers, and streams in memory.

### 8. Persist server-level settings

- [ ] Move the current workdir and default runner ID into `app_settings` with validated typed codecs and documented precedence between startup configuration and persisted mutable values.
- [ ] Add a state-inventory architecture test that fails when a new durable field is added to stable server state without a repository or an explicit ephemeral classification.
- [ ] Keep reload counts, SSE connections, auth-failure throttles, and timers ephemeral.
- [ ] Decide separately whether non-secret browser preferences should sync to SQLite.
- [ ] Keep authentication tokens out of general preference storage.

### 9. Import and cut over

- [ ] Provide dry-run and apply modes with source counts, destination counts, conflict reporting, and a migration ledger.
- [ ] Import checkpoints, routine definitions, and routine bindings while the service is stopped.
- [ ] Validate imported rows before renaming legacy files to dated backups.
- [ ] Start with SQLite-only app repositories; do not silently fall back to legacy writes.
- [ ] Retain legacy files as read-only backups for at least one release.
- [ ] Document backup, restore, downgrade, and failure-recovery procedures.

### 10. Complete validation

- [ ] Verify checkpoint trees and rollback records survive server replacement.
- [ ] Verify routine definitions, bindings, progress, logs, and interrupted-run reconciliation survive restart.
- [ ] Verify hublot identity, ownership, desired state, and history survive `server.mjs` replacement.
- [ ] Verify planned restart, crash recovery, PID-reuse protection, orphan cleanup, replacement URLs, and self-served interruption behavior.
- [ ] Verify a dead desired-open service is restarted from its persisted script, receives a new persisted PID, and has its tunnel reopened.
- [ ] Verify a missing startup-script file is rematerialized from its SQLite contents and hash.
- [ ] Verify repeated service failure triggers backoff and crash-loop protection rather than an unbounded spawn loop.
- [ ] Verify runner replay and selected workdir survive restart.
- [ ] Verify deleting a session removes all and only its checkpoints, routines, runs, logs, hublots, and lifecycle records.
- [ ] Verify a failed agent deletion preserves all owned resources.
- [ ] Verify a crash after agent deletion completes the cascade on restart.
- [ ] Verify fork deletion does not delete ancestor-owned resources.
- [ ] Verify both SQLite and JSONL session backends can safely reference the app database.
- [ ] Run `npm run build`, `npm test`, and the Docker/e2e matrix before cutover.

## Completion criteria

- SQLite is authoritative for every durable piece of pi-lot-ui application data.
- The coding agent remains the sole owner of its unchanged session schema and store.
- Memory contains only live runtime handles, transient connections, timers, queues, and rebuildable caches.
- Every session-owned checkpoint, routine, and hublot is cascade deleted when its session is deleted.
- Interrupted cross-store deletion is durably reconciled to completion without deleting another session's resources.
- Existing API, SSE, extension, checkpoint, routine, hublot, and runner behavior remains compatible.
- Legacy JSON stores and routine files are imported idempotently and retained as recoverable backups during the migration window.
