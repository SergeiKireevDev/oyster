# Endpoints Requiring Synchronous Work on Unbounded Input

“Unbounded input” here means filesystem, database-result, or runtime data with no application-level count or size cap—not request bodies, which are capped at 5 MiB by default and 100 MiB for uploads.

This version excludes blocking attributable solely to `DatabaseSync`, on the assumption that database access will become asynchronous. It still includes synchronous JavaScript processing and `JSON.stringify` performed after an asynchronous database query returns an unrestricted result set.

## Implementation status

Implemented database pushdown in the current change:

- SQLite folder counts and ordering now use `GROUP BY`/`ORDER BY`.
- SQLite active transcript branches and session families now use cycle-safe recursive CTEs.
- SQLite FTS scope filtering is applied in SQL before JavaScript rescoring.
- Usage analytics filters valid assistant-message payloads in SQL before aggregation.
- Pinned-widget, group, hublot, and routine repositories accept indexed domain filters; callers no longer load whole tables for visibility, ownership, container, duplicate, port, status, or session lookups.

Pagination, set-based position normalization, full SQL usage aggregation, and bounded collection response serialization remain follow-up work where noted below.

## Session data

- `GET /sessions` — uncapped session listing. The JSONL backend synchronously reads and parses every session file in the selected folder. Both backends synchronously decorate, correlate with live runners, and serialize every returned summary after retrieval.  
  **Database pushdown:** for SQLite, add pagination and keep cwd filtering and `ORDER BY modified_at` in SQL; join persisted archive/owner metadata in the listing query instead of decorating each row with repository lookups. Live-runner correlation is in-memory and cannot be pushed down unless runner state is persisted.  
  `server/http/routes/sessionRoutes.mjs:230`, `server/sessions/jsonlCatalog.mjs:200`

- `GET /session-by-id` — on JSONL, fallback lookup scans and parses every session file across every folder.  
  `server/http/routes/sessionRoutes.mjs:400`, `server/sessions/jsonlCatalog.mjs:243`

- `GET /session-entries` and `GET /session-messages` — synchronously load and process an entire session of unrestricted size; responses are also synchronously serialized.  
  **Database pushdown:** for SQLite, use a recursive CTE from `active_leaf_id` to return only active-branch entries in branch order, and project only fields needed by `/session-entries`. `/session-messages` still has an inherently unbounded response unless it gains pagination or a message/byte limit.  
  `server/http/routes/sessionRoutes.mjs:412`, `server/http/routes/sessionRoutes.mjs:419`

- `GET /session-folders` — the JSONL backend synchronously scans all session directories/files. For SQLite results, the code still synchronously counts, sorts, maps, and serializes the unrestricted session set after retrieval.  
  **Database pushdown:** replace `list()` plus JavaScript counting/sorting with `SELECT cwd, COUNT(*) AS count FROM sessions WHERE cwd IS NOT NULL GROUP BY cwd ORDER BY cwd`, optionally paginated.  
  `server/http/routes/sessionRoutes.mjs:426`, `server/sessions/jsonlCatalog.mjs:219`, `server/sessions/sqliteCatalog.mjs:222`

- `GET /search` — synchronous search logic across an unrestricted corpus. JSONL reads/parses files synchronously. For SQLite, query execution is excluded from this audit, but decoding entries, rebuilding active branches, matching text, rescoring, and serializing results remain synchronous. The 200-result cap does not bound sessions or entries examined.  
  **Database pushdown:** apply scope/cwd constraints before FTS, compute ranking/snippets in FTS/SQL where practical, and use `ORDER BY rank LIMIT ?` so only bounded candidates reach JavaScript. A recursive CTE can restrict entries to each active-leaf ancestry before payload decoding. Exact application-specific rescoring may still need a bounded JavaScript pass.  
  `server/http/routes/sessionRoutes.mjs:435`, `server/sessions/jsonlCatalog.mjs:333`, `server/sessions/sqliteCatalog.mjs:231`

- `GET /analytics/usage` — after database retrieval, synchronously parses payloads and aggregates, sorts, and serializes every matching assistant message. `range=all` is explicitly unrestricted, and time ranges have no row cap.  
  **Database pushdown:** filter assistant messages with `json_extract`, bucket timestamps in SQL, and calculate `SUM`/`COUNT` grouped by bucket and model with `GROUP BY`/`ORDER BY`. Return only aggregate rows rather than every message payload.  
  `server/http/routes/sessionRoutes.mjs:209`, `server/sessions/sqliteCatalog.mjs:303`

- `POST /session/archive` — builds a transitive family by synchronously listing the complete session catalog, then scans runners and updates every family member.  
  **Database pushdown:** for SQLite sessions, select descendants/ancestors with a recursive CTE and perform the archive change as one set-based `UPDATE` inside the transaction. Runner stopping remains in-memory but should consume only the returned family IDs.  
  `server/http/routes/sessionRoutes.mjs:267`, `server/http/routes/sessionRoutes.mjs:24`

- `DELETE /session` — scans uncapped runner, hublot, and routine collections; legacy JSONL path lookup can also parse an unrestricted session file.  
  **Database pushdown:** query hublots and routines directly by indexed owner/session ID instead of loading and filtering complete tables; use cascades or set-based deletes where lifecycle semantics permit. Runner matching remains in-memory.  
  `server/http/routes/sessionRoutes.mjs:315`

- `POST /open-session` — JSONL lookup by ID can scan and parse the entire catalog.  
  `server/http/routes/runnerRoutes.mjs:313`

## Checkpoints

- `POST /checkpoint` — recording the checkpoint synchronously loads/processes the entire session to locate its leaf.  
  **Database pushdown:** for SQLite, select the session's `active_leaf_id` and the latest eligible message anchor directly, using indexed lookups or an ancestry CTE, rather than loading and rebuilding the full active branch.  
  `server/http/routes/checkpointRoutes.mjs:66`, `server/checkpoints.mjs:40`

- `GET /checkpoints` — returns all checkpoints for a session without pagination; synchronous response construction and `JSON.stringify` remain proportional to the unrestricted result count.  
  **Database pushdown:** add cursor pagination with an indexed `WHERE` plus `ORDER BY timestamp, id LIMIT ?`. Sorting alone is insufficient because returning every checkpoint remains unbounded.  
  `server/http/routes/checkpointRoutes.mjs:104`

- `GET /checkpoint-tree` — synchronously lists/parses every session in the folder/family and loads all associated checkpoints.  
  **Database pushdown:** for SQLite, use a recursive CTE to select only the relevant ancestry/descendants and join checkpoints in one query, with child/checkpoint ordering expressed by `ORDER BY`. Tree nesting still occurs in JavaScript, but over only the selected family.  
  `server/http/routes/checkpointRoutes.mjs:113`, `server/checkpoints.mjs:60`

- `POST /rollback` — loads unrestricted session/checkpoint histories; JSONL rollback synchronously serializes and writes the whole fork branch.  
  **Database pushdown:** for SQLite, derive the fork ancestry with a recursive CTE and copy entries/checkpoint inheritance with `INSERT … SELECT` rather than materializing complete histories in JavaScript. This does not address the JSONL path.  
  `server/http/routes/checkpointRoutes.mjs:137`, `server/sessions/jsonlCatalog.mjs:488`

## Filesystem

- `GET /browse` — synchronous `readdirSync`, sorting, per-file `statSync`, and serialization over an unrestricted directory entry count.  
  `server/http/routes/fileRoutes.mjs:74`

- `POST /file-upload` — each request synchronously scans the complete destination directory for stale uploads. Chunk size is capped, but directory size is not. It also performs up to 100 MiB of synchronous file writes per chunk.  
  `server/http/routes/fileRoutes.mjs:178`, `server/http/routes/fileRoutes.mjs:12`

## Runners

- `GET /health`, `GET /runners`, and `GET /events` — synchronously construct/serialize the complete uncapped runner collection. Event replay itself is capped at 1 MiB.  
  `server/http/routes/openRoutes.mjs:76`, `server/http/routes/runnerRoutes.mjs:67`, `server/http/routes/runnerRoutes.mjs:132`

- `DELETE /runners` — stopping a runner family lists the complete session catalog and scans all runners.  
  **Database pushdown:** obtain the SQLite session-family IDs with a recursive CTE instead of listing the catalog. Runner matching and process termination remain in-memory.  
  `server/http/routes/runnerRoutes.mjs:137`, `server/http/routes/sessionRoutes.mjs:99`

## Pinned widgets

The following endpoints request uncapped `repository.list()`/`listGroups()` results, then synchronously filter/sort them, normalize positions with per-item loops, build DTOs, and return the full current collection. Database execution itself is excluded:

**Database pushdown:** use indexed `WHERE scope = ? AND owner_id IS ? AND group_id IS ?` queries with `ORDER BY position, id` rather than whole-table `list()` calls. Add pagination for collection responses. Reordering/normalization can use set-based range updates or window-function-derived positions inside one transaction instead of per-widget JavaScript update loops. Group-child moves/deletes can use set-based `UPDATE`/`DELETE` statements.

- `GET /pinned-widgets`
- `POST /pinned-widgets`
- `PATCH /pinned-widgets`
- `DELETE /pinned-widgets`
- `POST /pinned-widget-groups`
- `PATCH /pinned-widget-groups`
- `DELETE /pinned-widget-groups`

References: `server/pinned-widgets.mjs:484-705`, especially `server/pinned-widgets.mjs:202-271`.

`GET /pinned-widget-content` is not unbounded: it rejects files over 5 MiB. HTML/media endpoints stream file contents.

## Hublots and routines

- `GET /tunnels`, `POST /tunnels`, `PATCH /tunnels`, and potentially `DELETE /tunnels` synchronously search, map, and serialize uncapped persisted hublot/process result sets after retrieval.  
  **Database pushdown:** use indexed point/status/owner queries (`WHERE id = ?`, `WHERE status = ?`, `WHERE owner_id = ?`) instead of `listTunnels().find()` or whole-table filters; join process status when a combined view is needed. Paginate `GET /tunnels`.  
  `server/http/routes/tunnelRoutes.mjs:115-246`, `server/tunnels.mjs:208`

- `GET /routines` synchronously maps and serializes every persisted routine after retrieval.  
  **Database pushdown:** select only the requested scope/session, join the latest run/log summary in SQL, order in SQL, and paginate the result. Runtime `alive` state must still be merged from memory.  
  `server/http/routes/routineRoutes.mjs:53`, `server/routines.mjs:88`

- `POST /routines` with `action=generate` also returns the complete routine list. With session-bound `create`/`start`, it linearly scans the uncapped runner collection to find the session cwd.  
  **Database pushdown:** do not return the complete routine collection after generation; return the created routine or a paginated query. Persisted session cwd can be fetched by indexed session ID, although locating a live runner remains an in-memory concern.  
  `server/http/routes/routineRoutes.mjs:58`, `server/http/routes/routineRoutes.mjs:27`

## Main causes

1. Whole-file synchronous JSONL processing via `readFileSync`.
2. Uncapped directory and in-memory/result-set scans.
3. Synchronous parsing, mapping, filtering, sorting, aggregation, and DTO construction after data retrieval.
4. `json()` synchronously calls `JSON.stringify`, amplifying every uncapped response.  
   `server/http/createRequestContext.mjs:112`
