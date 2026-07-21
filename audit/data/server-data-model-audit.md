# Server data-model audit

**Scope:** Node server (`server.mjs`, `app.mjs`, domain modules, and `http/` routes)  
**Date:** 2026-07-15

## Executive assessment

The server is a filesystem- and process-oriented application, not a database-backed one. Its data falls into four layers:

1. **Canonical durable data owned by pi or the workspace:** session JSONL files, workspace files, and Git objects/refs.
2. **Server-owned durable metadata:** checkpoint JSON and routine-binding JSON, plus executable routine scripts.
3. **Hot-reload-durable but restart-ephemeral state:** runners, tunnels, routines' current execution state, SSE clients, auth failures, counters, and timers on the `state` object owned by `server.mjs`.
4. **Derived/cache/API views:** parsed sessions, summaries, search hits, trees, and client-safe projections.

The aggregate boundaries are understandable and the stable-core `state` ownership is a good fit for hot reload. Atomic rename and corrupt-file quarantine are used for the two server-owned JSON stores. However, schemas are implicit JavaScript objects spread across comments, constructors, parsers, and route responses. There is no schema versioning, migration framework for durable stores, referential-integrity enforcement, or transaction spanning Git, sessions, checkpoint metadata, and process startup.

## Storage map

| Model | Owner / implementation | Runtime location | Durable storage | Lifecycle |
|---|---|---|---|---|
| Server configuration | `server.mjs` | `state.config` | CLI/env; token may be read from `<repo>/.ui-token` | Fixed for process lifetime |
| Stable server state | `server.mjs` | host-owned `state` object | None | Survives `app.mjs` hot reload; lost on server restart |
| Runner | `runners.mjs` | `state.runners: Map<runnerId, Runner>` | No runner record; attached conversation persists separately as session JSONL | Hot-reload durable, restart-ephemeral |
| Runner replay event | `runners.mjs` | `Runner.buffer: string[]`, max 400 | None | Per-runner, process lifetime |
| SSE client/subscription | `runnerRoutes.mjs` | `state.sseClients: Set<ServerResponse>`; response is augmented with `runnerId` | None | Connection lifetime |
| Auth-failure history | `createRequestContext.mjs` | `state.authFails: Map<ip, number[]>` | None | Process lifetime, lazily expired |
| Session | pi + `sessions.mjs` | Parsed/cache views | `~/.pi/agent/sessions/--<encoded-cwd>--/*.jsonl` | Durable until session deletion |
| Parsed-session cache | `sessions.mjs` | module-level LRU `Map`, max 100 | None | Invalidated by path + mtime + size; lost on module replacement/restart |
| Session fork | `sessions.mjs` | Return object during creation | A new session JSONL file | Durable |
| Checkpoint metadata | `checkpoints.mjs` | Loaded object per operation | `~/.pi/agent/checkpoints.json` | Durable; atomic replace |
| Checkpoint content/state | Git | Child-process results only | Workspace Git commits, index, refs, and worktree | Durable according to Git operations |
| Checkpoint family tree | `checkpoints.mjs` | Derived object | None; joins session headers to checkpoint metadata | Request lifetime |
| Tunnel / hublot | `tunnels.mjs` | `state.tunnels: Map<tunnelId, Tunnel>` | None | Hot-reload durable; closed on server shutdown |
| Routine definition | `routines.mjs` | Merged into `state.routines` | Executable files in `~/.pi/routines/` | Durable until deleted |
| Routine binding | `routines.mjs` | Fields on `Routine` | `~/.pi/routines/bindings.json` | Durable; atomic replace |
| Routine execution | `routines.mjs` | Fields on `Routine`, including log and process | None | Status/log lost on restart |
| Routine scan cache | `routines.mjs` | module-level cache, TTL 500 ms | None | Invalidated on mutations |
| Current workdir | routes + runner manager | `state.currentDir` | None | Global mutable process setting |
| Browsed/edited/uploaded files | `fileRoutes.mjs` | Request buffers only | User-selected files under allowed roots | Durable filesystem data |
| Partial upload | `fileRoutes.mjs` | None between requests | `<target-dir>/.<name>.upload` | Exists until final rename, replacement, or explicit external cleanup |
| UI auth token | `server.mjs` | `state.config.TOKEN` | Optional `<repo>/.ui-token`; otherwise generated only in memory | Stable only if supplied or file already exists |

## Model catalogue

### 1. `Config`

**Lives in:** `server.mjs`, as `state.config`.

```text
Config {
  PORT: number
  HOST: string
  PI_BIN: string
  PI_DIR: absolute path
  PI_EXTRA_ARGS: string[]
  TOKEN: string
  TUNNEL_BIN: string
  DIRNAME: absolute path
}
```

Inputs are CLI flags, environment variables, defaults, and optionally `.ui-token`. The code reads an existing token file but does **not** create one when it generates a random token. This differs from the first-run persistence behavior described in `AGENTS.md`.

### 2. Stable `ServerState`

**Lives in:** `server.mjs`; dynamically extended by domain modules and request helpers.

```text
ServerState {
  config: Config
  currentDir: path
  tunnels: Map<string, Tunnel>
  sseClients: Set<ServerResponse & { runnerId?: string }>
  reloadCount: number
  broadcast(line): function
  serverEvent(object): function

  // lazily added
  runners?: Map<string, Runner>
  defaultRunnerId?: string | null
  runnerWatchdogTimer?: Timeout
  runnerReaperTimer?: Timeout
  routines?: Map<string, Routine>
  authFails?: Map<string, number[]>
  nextHublotPort?: number

  // legacy migration-only
  eventBuffer?: unknown
  pi?: ChildProcess | null
}
```

This object is the server's in-memory system of record for live resources. It deliberately survives hot reload because `server.mjs` is not re-imported. The shape is open and undocumented in one authoritative declaration; modules add properties opportunistically.

### 3. `Runner` and `RunnerInfo`

**Lives in:** `runners.mjs`; records are stored in `state.runners`.

```text
Runner {
  // durable descriptor fields mirrored from SQLite
  id: "r-<uuid>"
  dir: path
  sessionRef: SessionReference | null
  sessionFile: path | null
  sessionId: string | null
  sessionName: string | null
  startCount: number

  // explicitly ephemeral runtime fields
  busy: boolean
  proc: ChildProcess | null
  stdoutReader: Interface | null
  lastSpawnAt: epoch-ms
  resumeId: string | null
  resumeQueue: RpcCommand[]
  resumeTimer: Timeout | null
  watchdogOk: boolean
  lastLineAt: epoch-ms
  probeSentAt: epoch-ms | null
  probeMisses: number
}
```

`RunnerInfo` is the client-safe projection:

```text
{ id, dir, sessionFile, sessionId, sessionName, busy, alive: boolean }
```

A runner is related to a session by its backend-neutral `sessionRef`. Durable descriptors and UUID-based IDs survive restart; process handles and the explicitly classified runtime fields above survive only hot reload. Dead runner descriptors remain available for lazy restart until their owning session is deleted.

The `/rpc` command is intentionally opaque except for requiring an object with a string `type`; it is forwarded to pi's JSONL RPC protocol. Server-created commands add `id`, `type`, and command-specific fields.

### 4. Event and SSE models

Runner stdout is stored as serialized JSON strings, not parsed event objects. Parseable lines receive an `_sseId` UUID. Server-created events have `_server: true`; runner-scoped server events also have `runner: runnerId`.

Important server event variants include:

- `replay_done`: runner identity, process status, workdir, and runner list.
- `ping`: runner list.
- `runners_update`: runner list.
- Runner events: `pi_started`, `pi_exit`, `pi_error`, `runner_unhealthy`.
- Resource events: `tunnel_opened`, `tunnel_closed`, `hublot_ready`, `hublot_failed`, `routine_update`.
- Reload events: `code_reloaded`, `code_reload_failed`, `ui_reload`.

Global server events are not replayed. Runner replay is stored in SQLite `runner_events`, capped at 400 lines per runner; no replay copy is retained on the runtime runner object. `ServerResponse` objects are used as subscription records by attaching `runnerId`, coupling transport objects to application state.

### 5. Auth-failure model

**Lives in:** `state.authFails` via `http/createRequestContext.mjs`.

```text
Map<clientIp, epochMilliseconds[]>
```

Twenty failures in ten minutes throttle an IP. Timestamps are pruned only when that IP is checked again; inactive IP keys are not globally swept, so a high-cardinality attack can grow the map for the process lifetime.

### 6. Session persistence model

**Lives in:** `sessions.mjs`; canonical files are written primarily by pi.

A session is newline-delimited JSON:

```text
SessionFile = SessionHeader + SessionEntry*

SessionHeader {
  type: "session"
  id: string
  timestamp?: ISO string
  cwd?: path
  parentSession?: absolute session-file path
  forkedAtHash?: git hash       // server extension; pi ignores it
  ...pi-owned fields
}

SessionEntry {
  type: string
  id?: string
  parentId?: string | null
  timestamp?: string
  ...variant fields
}
```

Known entry variants consumed by this server:

- `message`: `{ message: Message }`
- `session_info`: `{ name }`
- `model_change`: `{ modelId }`
- `thinking_level_change`: `{ thinkingLevel }`
- Other pi entries are retained generically.

```text
Message {
  role: "user" | "assistant" | "toolResult" | string
  content: string | ContentBlock[]
  ...pi-owned fields
}

ContentBlock =
  | { type: "text", text: string }
  | { type: "thinking", thinking: string }
  | { type: "toolCall", name: string, arguments?: object }
  | { type: "toolResult", ... }
  | other pi-defined block
```

Entries form a tree through `id`/`parentId`. The active branch is defined as the chain from the **last id-bearing file entry** back to the root. This is an implicit and important invariant.

Session folders use `--${cwd-with-separators-replaced-by-dashes}--`. This encoding is lossy and collision-prone: path separators and literal dashes cannot be distinguished.

#### Parsed and derived session models

`parseSessionFile` returns:

```text
ParsedSession {
  header: SessionHeader | null
  name: string | null            // last session_info name
  entries: SessionEntry[]
  byId: Map<string, SessionEntry>
}
```

Malformed lines are silently skipped. Duplicate IDs overwrite earlier entries in `byId` while remaining duplicated in `entries`.

API/derived projections include:

- `SessionSummary`: `id`, `createdAt`, `name`, `cwd`, `parentSession`, first-user `preview`, `messageCount`, plus list-time `path`, `modifiedAt`, and live runner fields `runnerId`, `alive`, `busy`.
- `SessionHeaderInfo`: `path`, `id`, `name`, `cwd`, `createdAt`, `parentSession`, `forkedAtHash`.
- `SessionFolder`: `dir`, encoded `name`, lossy display `label`, `count`.
- `SessionTreeNode`: `id`, `parentId`, `type`, `timestamp`, `role`, short `label`.
- `ActiveSessionEntries`: `sessionId`, `leafId`, and `{ id, role, text, timestamp }[]`.
- `ActiveSessionMessages`: `sessionId` and full pi `Message[]`.
- `SearchHit`: entry metadata, snippet `{before, match, after}`, session identity/path/preview/cwd, and folder metadata.

#### Session fork

`forkSessionAt` creates a new file with a UUID session ID, copies the ancestor chain through a selected leaf while preserving entry IDs, and adds absolute `parentSession` plus optional `forkedAtHash` to the header.

```text
ForkResult { path, id, entryIds: Set<string> }
```

Absolute parent paths make family relationships fragile if the sessions directory is moved or files are renamed.

### 7. Checkpoint models

**Lives in:** `checkpoints.mjs`.

The durable metadata store is a JSON object keyed by session ID:

```text
CheckpointDb = Record<sessionId, CheckpointRecord[]>

CheckpointRecord {
  hash: string
  anchorId: string
  leafId: string | null
  dir: absolute workspace path
  sessionPath: absolute session-file path
  message: string | null
  timestamp: ISO string
}
```

A record points simultaneously to a Git commit, a workspace, a session file, and session entry IDs. A record is deduplicated only by `hash + anchorId` within one session list.

`saveCheckpoints` writes `checkpoints.json.tmp` then renames it. Invalid JSON is renamed to `checkpoints.json.corrupt-<epoch>`. The write is not fsynced, and write errors are logged but not propagated; callers may report a checkpoint as recorded even if persistence failed.

Rollback copies inherited checkpoint records into the fork's own session-ID bucket, changing `sessionPath`. This simplifies reads but denormalizes lineage and can create divergent copies.

`CheckpointTreeNode` is derived by joining session headers and the checkpoint DB:

```text
CheckpointTreeNode {
  ...SessionHeaderInfo
  forkedAtHash: string | null
  checkpoints: Array<{ hash, anchorId, message, timestamp }>
  children: CheckpointTreeNode[]
}
```

Tree traversal is capped at depth 25. Legacy `forkedAtHash` is inferred from inherited records.

The actual checkpointed workspace state is not in `checkpoints.json`; it is a Git commit. `checkpointWorkdir` returns either a clean-HEAD marker or committed result:

```text
CheckpointResult {
  committed: boolean
  reason?: string
  hash?: string
  message?: string
  files?: number
  dir?: path
  summarized?: boolean
  recorded?: boolean       // route augmentation
  anchorId?: string        // route augmentation
}
```

### 8. Tunnel / hublot model

**Lives in:** `tunnels.mjs`; stored only in `state.tunnels`.

```text
Tunnel {
  id: 12-hex-character string
  port: integer
  label: string | null
  sessionId: string | null
  url: string | null
  workdir: path
  createdAt: ISO string
  proc: ChildProcess
  agentProc?: ChildProcess
  servicePid?: number
}
```

`TunnelInfo` strips `proc` and `agentProc` but includes the other fields, including `servicePid` when set. Tunnels are session-bound by an unchecked string ID, can be rebound, and do not survive server restart. The relation to a session is used for filtering and cleanup but has no referential validation.

### 9. Routine models

**Lives in:** `routines.mjs`.

The durable definition is the executable file itself. Every executable regular file or symlink under `~/.pi/routines/` is considered a routine except `bindings.json`, which is non-executable.

```text
Routine {
  name: filename
  path: absolute path
  sessionId: string | null
  cwd: path | null
  status: "idle" | "running" | "stopping" | "teardown" |
          "done" | "stopped" | "failed"
  progress: number | null
  message: string | null
  startedAt: ISO string | null
  finishedAt: ISO string | null
  exitCode: number | null
  log: string[]                 // max 80 non-progress lines
  proc: ChildProcess | null
}
```

`RoutineInfo` strips `proc` and adds `alive: boolean`.

Bindings are durable, separately from the scripts:

```text
RoutineBindings = Record<routineName, {
  sessionId: string | null
  cwd: path | null
}>
```

Bindings use temp-file + rename and corrupt-file quarantine. Live execution status, timestamps, progress, exit result, and logs are not persisted; after restart, a disk scan reconstructs an idle routine with only the binding. The server cannot reattach to a routine process that outlives an abnormal server exit.

### 10. Workspace file and upload models

The file browser has no metadata database. Directory and file views are derived directly from `readdir/stat`:

```text
DirectoryView {
  path, parent, home, workdir,
  dirs: Array<{ name, hidden }>,
  files?: Array<{ name, size: number | null, hidden }>
}
```

Browser edits are written to `.<basename>.save-<pid>-<epoch>` and atomically renamed over the target. Chunked uploads use a deterministic `.<name>.upload` staging file and byte offsets. The upload protocol's state is therefore the staging file's current size; no owner, upload ID, checksum, expiry, or lock is stored. Concurrent uploads to the same directory/name share and can corrupt or replace the same staging object.

Safe file roots are computed once per request-context construction from `$HOME`, `/tmp`, and configured `PI_DIR`; selected credential subtrees and `.ui-token` are denied. This is an authorization/path policy rather than a persisted model.

## Relationships and aggregate boundaries

```text
Session (id, file path, cwd)
  ├── 0..1 live Runner by sessionFile (convention, not constraint)
  ├── 0..* CheckpointRecord by sessionId
  │      ├── anchorId/leafId -> SessionEntry.id
  │      └── hash + dir -> Git commit/workspace
  ├── 0..* child Session via child.header.parentSession == parent file path
  ├── 0..* Tunnel by sessionId
  └── 0..* RoutineBinding by sessionId

Runner 1 ── 0..* SSE clients through response.runnerId
Routine 1 ── 0..1 process and 1 executable script
Tunnel 1 ── 1 cloudflared process; optionally agent/service processes
```

The session is the conceptual hub, but there is no single session aggregate transaction. Session deletion explicitly stops/removes matching runners, closes matching tunnels, and releases matching routines before unlinking the JSONL file. It does **not** remove the session's checkpoint bucket, leaving orphaned checkpoint metadata.

## Strengths

- Clear distinction between stable-core state and hot-reloadable behavior.
- Domain modules have recognizable ownership: sessions, runners, checkpoints, tunnels, routines.
- Child-process handles are removed from most client projections.
- Session parsing is centralized and mtime/size-cached.
- Durable checkpoint and routine-binding JSON use atomic rename and quarantine corrupt input rather than silently overwriting it.
- Session entry IDs support stable message anchors and deterministic branch/fork reconstruction.
- Process-local mutations are mostly synchronous around load-modify-save, avoiding `await` races in those critical sections.
- Workspace edits use atomic rename; chunk uploads support ordered retries.

## Risks and gaps, prioritized

### High

1. **No explicit or versioned durable schemas.** `SessionHeader`, `CheckpointDb`, and `RoutineBindings` are accepted after plain `JSON.parse`; structurally valid but malformed values can fail later or produce incorrect relationships. There is no `schemaVersion` or migration path.
2. **Rollback is a non-transactional multi-system workflow.** It may commit pending work, reset Git, write a fork session, rewrite checkpoint metadata, and spawn a runner. Failure after `git reset --hard` can leave the worktree changed without a usable fork/metadata response. There is no operation journal or compensation plan.
3. **Checkpoint persistence failures are swallowed.** `saveCheckpoints` logs and returns normally. `recordCheckpoint` can return a record and the route can set `recorded: true` even when the file was not saved.
4. **Checkpoint references are fragile and orphaned.** Records hold absolute workspace/session paths and external Git hashes. Session deletion leaves their DB bucket behind; repository history rewrites, directory moves, or file renames break records.
5. **Session folder encoding can collide.** Replacing both separators and path structure with `-` maps distinct cwd values to the same directory.

### Medium

6. **`ServerState` has no authoritative shape or invariants.** Lazy module mutation is practical but makes compatibility across hot reloads dependent on ad hoc checks and one-off migrations.
7. **Session parsing is permissive in ways that hide corruption.** Invalid lines are skipped without diagnostics, duplicate IDs are accepted, parent cycles/missing parents are not validated, and active branch selection relies on the last id-bearing entry.
8. **Cross-model session IDs are unchecked.** Tunnels and routine bindings can reference nonexistent or wrong sessions; IDs are free strings supplied by clients. Routine cwd falls back to a global current workdir if no matching live runner exists.
9. **Global mutable `currentDir` creates cross-session coupling.** Opening/changing one workdir affects default runners, routines without a resolvable runner, tunnels, and hublot agents for all clients.
10. **Live process models are unrecoverable after restart.** Tunnels disappear; runner identities reset; routine execution status resets to idle and detached process groups may become unmanaged after a crash.
11. **Partial uploads lack identity and concurrency control.** Two clients uploading the same target race on one staging filename; abandoned staging files have no expiry cleanup.
12. **Auth-failure keys are only lazily cleaned.** Many unique client IPs can cause process-lifetime map growth.

### Low / clarity

13. **Client projections are implicit and inconsistent.** `tunnelInfo` can expose `servicePid`; `routineInfo` shallow-copies arrays; response shapes are defined inline in routes rather than reusable contracts.
14. **Durability is atomic-replace but not crash-durable.** JSON stores and file saves do not fsync the file and parent directory.
15. **Token behavior/documentation disagree.** The implementation reads `.ui-token` but does not persist a newly generated token, while project guidance says first run writes it.
16. **Caches are implementation-global.** Their lifecycle follows cache-busted ESM instances rather than an explicit state/cache owner, making hot-reload memory and invalidation behavior less obvious.

## Recommended target model

Keep the filesystem-centric architecture, but make its contracts explicit:

1. Add a small `models/` layer (JSDoc typedefs or TypeScript plus runtime validators) for `ServerState`, `Runner`, `SessionHeader/Entry`, `CheckpointDb`, `Tunnel`, `Routine`, and all durable-file formats.
2. Add `schemaVersion` to server-owned JSON stores and validate on load. Quarantine semantically invalid stores as well as invalid JSON.
3. Make save functions return success or throw; never claim `recorded` unless durable write succeeds.
4. Introduce stable identifiers in checkpoint metadata: retain paths for lookup, but treat `sessionId`, repository identity, and full commit hash as canonical. Garbage-collect checkpoint buckets on session deletion and report dangling records in a health/audit endpoint.
5. Replace lossy session-folder encoding with pi's canonical encoding if available, or a reversible encoding; retain compatibility lookup for existing directories.
6. Model rollback as an operation with stages and a journal, or reorder/compensate steps so every failure has a deterministic recoverable state.
7. Separate global server default workdir from runner/session workdirs; require an explicit session/runner context for session-bound resource creation.
8. Give uploads a random upload ID, target metadata, expected size/checksum, and expiry; lock finalization per target.
9. Add periodic cleanup for auth failures, stale dead runners, orphan checkpoint records, and abandoned upload files.
10. Define explicit public DTO builders so process handles, PIDs, mutable arrays, and internal fields cannot leak accidentally.

## Suggested source-of-truth hierarchy

- **Conversation:** session JSONL, keyed by session ID; path is a locator, not identity.
- **Workspace snapshot:** Git object ID in a repository; use full hash internally.
- **Checkpoint:** versioned server metadata joining session entry ID to repository commit ID.
- **Runner/tunnel/routine execution/SSE:** process-local operational state only.
- **Routine definition and binding:** executable script plus versioned binding metadata.
- **Search, lists, trees, summaries:** disposable projections rebuilt from canonical stores.
