# SQLite and file-storage data audit

**Repository:** `/home/ubuntu/tree-pi-bak-sql`  
**Scope:** server-side data models, the selected pi session backend, and persistent/runtime storage boundaries  
**Date:** 2026-07-16

## Executive answer

SQLite has replaced JSONL **only as the default canonical store for pi conversations/sessions**. It has not replaced the server's other filesystem stores.

With the default configuration (`PERSISTENT_STORE=sqlite`), new durable conversation data lives in:

```text
~/.pi/agent/sessions.sqlite
~/.pi/agent/sessions.sqlite-wal   # while WAL has uncheckpointed data
~/.pi/agent/sessions.sqlite-shm   # while SQLite clients are active
```

The database contains session identity and lineage, the complete session-entry tree and entry payloads, active leaves and branch materializations, append sequences, transcript discovery text, and materialized session statistics/configuration.

The following still live in files rather than SQLite:

- Checkpoint metadata: `~/.pi/agent/checkpoints.json`
- Checkpointed workspace state: Git repository files and Git object database
- Routine scripts: `~/.pi/routines/<executable>`
- Routine bindings: `~/.pi/routines/bindings.json`
- Workspace/project files and browser uploads
- Optional UI token: `<pi-lot-ui>/.ui-token`
- Pi configuration, model, extension, and credential files under the agent/home directories
- Existing JSONL sessions when JSONL mode has been used

Live runners, tunnels, routine executions, SSE clients, event replay, auth failures, timers, and process handles remain memory-only.

SQLite and JSONL are independent stores. Switching `PERSISTENT_STORE` changes which one pi and the UI use; it does not migrate, merge, rewrite, or delete the other.

## Storage matrix

| Data model | SQLite mode | JSONL mode | Runtime copy/cache | Owner |
|---|---|---|---|---|
| Session header/identity | `sessions` table | First line of each `.jsonl` | Catalog summaries | pi |
| Session entry tree | `session_entries` | Remaining JSONL lines | Decoded per request; JSONL has LRU | pi |
| Active session leaf | `sessions.active_leaf_id` | Last id-bearing entry convention | Catalog active-branch result | pi/catalog |
| Append order | `session_entries.entry_seq` + `session_sequences` | Physical line order | None | pi |
| Materialized branches | `branch_entries` | Rebuilt from `parentId` links | Temporary maps/arrays | pi |
| Session name/stats/model state | `session_materialized` and `entry_materialized` JSON payloads | Derived by parsing entries | Catalog projection | pi |
| Session discovery text | `sessions.first_message`, `all_messages_text` | Derived by scanning messages | Search result | pi/catalog |
| Schema migrations | `migrations` | Session header `version` | None | agent-core / pi |
| Checkpoint metadata | **Not in SQLite**: `checkpoints.json` | Same | Loaded on each operation | pi-lot-ui |
| Workspace checkpoint | **Not in SQLite**: Git | Same | Git command results | Git |
| Routine definition | **Not in SQLite**: executable file | Same | `state.routines` | pi-lot-ui/user |
| Routine binding | **Not in SQLite**: `bindings.json` | Same | Fields on live routine | pi-lot-ui |
| Routine run/log/progress | Not persisted | Not persisted | `state.routines` | pi-lot-ui |
| Tunnel/hublot | Not persisted | Not persisted | `state.tunnels` | pi-lot-ui |
| Runner | Not persisted | Not persisted | `state.runners` | pi-lot-ui |
| Runner replay | Not persisted | Not persisted | `Runner.buffer`, max 400 | pi-lot-ui |
| SSE subscription | Not persisted | Not persisted | `state.sseClients` | pi-lot-ui |
| Auth failures | Not persisted | Not persisted | `state.authFails` | pi-lot-ui |
| Current workdir | Not persisted | Not persisted | `state.currentDir` | pi-lot-ui |
| Project/workspace content | Filesystem | Filesystem | Request buffers | User/tools |
| Browser partial upload | `.<name>.upload` file | Same | Request body only | pi-lot-ui |
| UI auth token | Optional `.ui-token` file | Same | `config.TOKEN` | pi-lot-ui |

## Configuration and source of truth

`server.mjs` selects one session backend at process startup:

```text
PERSISTENT_STORE = "sqlite" | "jsonl"       default: sqlite
PI_CODING_AGENT_DIR                           default: ~/.pi/agent
SQLITE_PATH                                   <agent-dir>/sessions.sqlite
```

`--session-dir <dir>` relocates the SQLite database to `<dir>/sessions.sqlite`. SQLite mode requires Node.js 22.19 or newer and defaults to the explicitly built local coding-agent CLI at:

```text
/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js
```

Every pi subprocess receives the same `PERSISTENT_STORE` through `pi-processes.mjs`. One-shot checkpoint-summary and hublot agents receive `--no-session`, so they should not create session rows.

The server itself treats the configured catalog as the only visible session store. Existing JSONL remains untouched but is not combined into SQLite-mode session lists. To see/use it, the service must be explicitly started in JSONL mode.

## What is stored in SQLite

### Database ownership

The schema and write implementation live in the local pi checkout, principally:

- `/home/ubuntu/pi-coding-agent/packages/agent/src/harness/session/sqlite/`
- `/home/ubuntu/pi-coding-agent/packages/coding-agent/src/core/sqlite-session-repository.ts`

pi runner processes create and append sessions. `tree-pi-bak-sql/sessions/sqliteCatalog.mjs` opens request-scoped **read-only** `node:sqlite` handles for lists, transcript hydration, trees, and searches.

Delete and exact-entry fork are write operations, but pi-lot-ui does not issue ad hoc workflow SQL. `session-operations.mjs` imports `CodingAgentSqliteSessionRepository` from the configured pi build and delegates those mutations to its repository API.

### `migrations`

```text
migrations {
  id TEXT PRIMARY KEY
  applied_at TEXT NOT NULL
}
```

Records applied SQL migration files. Current inspected migrations are `001_initial.sql` and `002_session_discovery.sql`.

### `sessions`

```text
sessions {
  id TEXT PRIMARY KEY
  created_at TEXT NOT NULL
  cwd TEXT NOT NULL
  parent_session_id TEXT NULL
  metadata TEXT NULL                 # JSON
  active_leaf_id TEXT NULL
  updated_at TEXT NULL
  first_message TEXT NULL
  all_messages_text TEXT NULL
}
```

This is the canonical session header and discovery record.

- `id` is the stable identity used to resume with `pi --session <id>`.
- `cwd` scopes lists and replaces JSONL's encoded per-workdir folder.
- `parent_session_id` stores fork lineage by stable ID rather than file path.
- `metadata` carries extensible JSON, such as `importedFrom` during JSONL import.
- `active_leaf_id` identifies the active point in the entry tree.
- `updated_at`, `first_message`, and `all_messages_text` accelerate discovery/listing.

All working directories share one database by default. A database path alone is therefore not a session identity.

### `session_entries`

```text
session_entries {
  session_id TEXT NOT NULL
  id TEXT NOT NULL
  entry_seq INTEGER NOT NULL
  parent_id TEXT NULL
  type TEXT NOT NULL
  timestamp TEXT NOT NULL
  payload TEXT NOT NULL              # JSON
  PRIMARY KEY (session_id, id)
}
```

This table stores the complete append-only session event/tree content. Shared fields are relational columns; type-specific fields remain in `payload` JSON. Entry variants include messages, session info/name, model and thinking changes, tool/config changes, compactions, branch summaries, labels, custom entries, and leaf-navigation entries.

Message payloads contain the durable user/assistant/tool transcript, content blocks, tool calls/results, model/provider details, token usage, cost, timestamps, and other pi-defined message fields.

`entry_seq` preserves serialization order. `parent_id` creates the conversation tree.

### `session_sequences`

```text
session_sequences {
  session_id TEXT PRIMARY KEY
  next_seq INTEGER NOT NULL
}
```

Allocates the next append sequence for a session.

### `branch_entries`

```text
branch_entries {
  session_id TEXT NOT NULL
  branch_id TEXT NOT NULL
  entry_id TEXT NOT NULL
  entry_seq INTEGER NOT NULL
  PRIMARY KEY (session_id, branch_id, entry_id)
}
```

Materializes branch membership and order, avoiding repeated full parent-chain traversal. The newest branch activity identifies the active branch in agent-core storage behavior.

### `session_materialized`

```text
session_materialized {
  session_id TEXT PRIMARY KEY
  payload TEXT NOT NULL              # JSON
}
```

The JSON payload caches session-level state derived from entries:

- Session name
- Message count
- Cached, uncached, and total token counts
- Total cost
- Current model/provider
- Current thinking level

### `entry_materialized`

```text
entry_materialized {
  session_id TEXT NOT NULL
  entry_seq INTEGER NOT NULL
  type TEXT NOT NULL
  payload TEXT NOT NULL              # JSON
  PRIMARY KEY (session_id, entry_seq, type)
}
```

Stores entry-associated materializations that supplement the session summary, including labels and observed model/thinking configurations.

### SQLite sidecar files

The repository configures WAL mode, `synchronous=FULL`, and a five-second busy timeout. A live database may therefore consist of three files:

```text
sessions.sqlite
sessions.sqlite-wal
sessions.sqlite-shm
```

Copying only `sessions.sqlite` while writers are active is not a valid backup. Stop all pi writers and checkpoint WAL, or use SQLite's online backup API. For a stopped filesystem backup, preserve the database and any remaining WAL/SHM sidecars together.

## SQLite-derived API models

The SQLite catalog projects relational rows into the same UI shapes formerly produced from JSONL:

- Session summary: ID, creation/update time, name, cwd, parent session ID, preview, message count, database path.
- Active entries: session ID, active leaf ID, and user/assistant entry anchors.
- Active messages: complete message objects along the active parent chain.
- Session tree nodes: entry ID, parent ID, type, time, role, and label.
- Session folders: distinct cwd values and counts; these are logical workdir groups, not filesystem folders.
- Search hits: entry, role/kind, timestamp, snippet, and session metadata.

Search currently decodes and scans `session_entries` in JavaScript. It does not use FTS5, and `all_messages_text` is not used by the UI catalog's search implementation.

## Backend-neutral identity

A persisted session is represented as:

```text
SessionReference {
  backend: "sqlite" | "jsonl"
  id: string
  storagePath: absolute path
}
```

For SQLite:

```text
{ backend: "sqlite", id: "session-id", storagePath: "~/.pi/agent/sessions.sqlite" }
```

For JSONL:

```text
{ backend: "jsonl", id: "session-id", storagePath: ".../<session>.jsonl" }
```

References are encoded into URL-safe `ps1_...` keys. The key is an identity envelope, not a secret or authorization token. It embeds backend, ID, and absolute storage path. The server revalidates SQLite paths against the configured database and JSONL paths against the configured sessions root.

Runners now retain `sessionRef`; `sessionFile` is null for SQLite and remains only for JSONL compatibility. Multiple SQLite sessions sharing one database are distinguished correctly by ID.

## What remains in file storage

### 1. Checkpoint metadata

Still stored at:

```text
~/.pi/agent/checkpoints.json
```

Shape:

```text
CheckpointDb = Record<sessionId, CheckpointRecord[]>
CheckpointRecord {
  hash, anchorId, leafId, dir,
  sessionRef,
  sessionPath?,          # JSONL compatibility only
  message, timestamp
}
```

SQLite session references are now recorded, but the records themselves are not SQLite rows. The JSON store still uses temp-file plus rename and corruption quarantine. Save failures are logged rather than propagated.

Deleting a SQLite or JSONL session does not remove its checkpoint bucket, so orphan checkpoint metadata can remain.

### 2. Git checkpoint state

The actual workspace snapshot remains a Git commit in each project's `.git` object store. `checkpoints.json` only links a session entry to a Git hash and workspace path. SQLite does not make rollback transactional with Git.

Rollback has been made safer by creating the session fork before `git reset --hard`, but the complete workflow still crosses SQLite/JSONL, checkpoint JSON, Git, and runner startup without one transaction.

### 3. JSONL sessions

JSONL remains a complete independent backend at:

```text
~/.pi/agent/sessions/--<encoded-cwd>--/*.jsonl
```

Each file contains a header followed by entry objects. JSONL mode retains its mtime/size-keyed 100-file LRU cache. Switching to SQLite does not import or delete these files. Import/export helpers exist in the local pi source, but server startup performs no automatic migration.

### 4. Routine definitions and bindings

```text
~/.pi/routines/<routine-name>       # executable script
~/.pi/routines/bindings.json        # sessionId and cwd by routine name
```

Only binding and cwd survive restart. Execution status, progress, timestamps, exit code, log tail, and process handle remain in `state.routines` and are lost on restart.

### 5. Workspace and browser-managed files

Project source, generated artifacts, and routine byproducts remain normal files. Browser saves use temporary sibling files and atomic rename. Chunked uploads stage data in:

```text
<target-dir>/.<filename>.upload
```

Git, not SQLite, versions workspace content.

### 6. Configuration, credentials, extensions, and token

The server still consumes filesystem/env configuration. Relevant files include:

- Optional `<pi-lot-ui>/.ui-token`
- pi agent configuration/model/credential files under `~/.pi/agent` or `$HOME`
- pi extensions under `~/.pi/agent/extensions/`
- systemd configuration in `pi-ui.service`

These are not represented in `sessions.sqlite`.

## What remains memory-only

The stable `state` object still owns hot-reload-durable operational data:

- `state.runners`: runner metadata, child process, resume queue, watchdog fields, replay buffer
- `state.tunnels`: tunnel process, agent process, service PID and public URL
- `state.routines`: live execution state and output tail
- `state.sseClients`: open response objects with runner subscription
- `state.authFails`: per-IP failure timestamps
- `state.currentDir`, counters, timer handles, catalog/codec/launcher service objects

These survive `app.mjs` hot reload but not a Node process restart. SQLite does not restore live processes.

## Data flows

### New SQLite conversation

```text
Browser -> /rpc -> runner stdin -> SQLite-enabled pi
                                -> sessions/session_entries/materializations
UI catalog <- read-only node:sqlite connection <- sessions.sqlite (+ WAL)
```

No session `.jsonl` is created.

### Resume

```text
sessionKey -> validated SessionReference -> runner deduplication
           -> pi --mode rpc --session <id>
           -> pi opens <configured sessions.sqlite>
```

### Delete

```text
sessionKey -> stop matching runner
           -> imported pi repository deleteById(id)
           -> delete session-related SQLite rows transactionally
           -> release hublots/routines
```

The shared database file is never unlinked for a single-session delete.

### Fork and checkpoint rollback

```text
checkpoint JSON + SQLite session entry ID + Git hash
 -> pi repository exact-entry SQLite fork
 -> Git reset --hard
 -> inherited checkpoint records written to checkpoints.json
 -> new runner starts with --session <fork-id>
```

## Assessment

### Improvements over the JSONL-only version

- Session identity is stable and no longer tied to a file path.
- Fork lineage uses parent session IDs rather than absolute parent file paths.
- Session listing is indexed by cwd and update time.
- Entry IDs, ordering, parent links, active leaf, and branch materialization are explicit.
- Session stats/configuration are materialized for fast resume and listing.
- Delete and fork use pi's repository abstraction rather than unsafe direct SQL in route handlers.
- SQLite readers are short-lived, read-only, parameterized, and compatible with concurrent WAL writers.
- JSONL rollback is retained without destructive automatic migration.
- The service validates the actual SQLite-capable pi executable and Node runtime.

### High-priority concerns

1. **Only sessions moved to SQLite.** Checkpoint and routine-binding metadata still have the original JSON-file durability and schema problems. There is no transaction joining them to session deletion/fork.
2. **Checkpoint persistence can still lie.** `saveCheckpoints` swallows write errors, while callers can report `recorded: true`.
3. **Session deletion leaves checkpoint orphans.** SQLite referential cleanup cannot cover a separate JSON store.
4. **External-side-effect transactions remain impossible.** SQLite transactions do not include Git resets/commits, process spawn, tunnels, routines, or JSON checkpoint writes.
5. **The UI is coupled to a specific evolving pi schema.** `sqliteCatalog.mjs` executes raw selects against columns added by migration 002 and decodes agent-core payload conventions. There is no schema capability/version handshake before queries.
6. **No declared foreign keys in the inspected schema.** Session/entry/branch/materialized relationships are maintained by repository code and manual transactional deletes, not SQLite foreign-key constraints.

### Medium-priority concerns

7. **Search does not exploit SQLite indexing.** It loads and decodes every selected session entry in JavaScript; FTS5 would materially improve large-history search.
8. **Opaque keys encode absolute storage paths.** Relocating the agent directory/database invalidates saved keys and links even though session IDs remain stable.
9. **One database increases failure and backup scope.** JSONL corruption was naturally isolated per session; all sessions now share schema, WAL, and backup lifecycle.
10. **Both stores can diverge by design.** This is safe for rollback, but there is no combined catalog or indication in the UI that valid sessions exist in the inactive backend.
11. **SQLite catalog reads are synchronous.** `DatabaseSync` queries and JavaScript transcript scans run on the server event loop and can delay SSE traffic for large stores.
12. **Materialized and canonical fields duplicate data.** Correctness depends on agent-core transactions updating entries, active leaf, summaries, discovery text, and branch materializations together.
13. **Live operational state remains unrecoverable.** Server restart loses runners, replay tails, tunnel registrations, and routine progress, even though conversations survive.

## Recommended next steps

1. Move checkpoint metadata and routine bindings into a separate **pi-lot-ui metadata SQLite database**, not into pi's session schema. Use foreign-key-like application checks against session references and version migrations.
2. Make checkpoint saves throw on failure and only return `recorded: true` after confirmed persistence.
3. Garbage-collect checkpoint records when sessions are deleted, with an audit command for existing orphans.
4. Add a supported session-repository/catalog API from pi so the UI does not query private tables directly.
5. Add schema-version/capability checks and reject incompatible databases with a clear diagnostic.
6. Add FTS5 maintained by the pi writer, or use `all_messages_text` for a first indexed coarse filter before entry-level snippet generation.
7. Use a path-independent public session key where possible: backend/store identifier plus session ID, resolving the current database path server-side.
8. Add database integrity checks, online backup tooling, and restore drills to service operations.
9. Keep Git and workspace files outside SQLite; model rollback as a journaled multi-stage operation rather than trying to include external state in a DB transaction.
10. Preserve JSONL import/export as explicit administrative commands and clearly label inactive-backend data rather than silently merging stores.

## Bottom line

The migration correctly makes SQLite the canonical store for **conversation/session data**, including full transcript trees and derived session state. It does not make SQLite the canonical store for the entire pi-lot-ui system. The architecture remains intentionally hybrid:

```text
SQLite     -> pi sessions, entries, branches, lineage, transcript discovery and stats
JSON files -> checkpoints and routine bindings
Executables-> routine definitions
Git        -> workspace checkpoints
Filesystem -> projects, uploads, configuration, credentials and optional JSONL rollback
Memory     -> runners, tunnels, live routine state, SSE, replay and rate limiting
```

That boundary is broadly sound. The next consolidation target should be server-owned metadata, especially checkpoints—not workspace files, Git objects, or live process state.
