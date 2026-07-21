# Wire the Local SQLite-Enabled pi into pi-lot-ui

## Goal

Run pi-lot-ui against the SQLite-enabled coding-agent checkout at
`/home/ubuntu/pi-coding-agent`, select `PERSISTENT_STORE=sqlite` explicitly,
and make saved-session behavior honest and usable when sessions are identified
by a database plus session ID rather than by one `.jsonl` file per session.

The local checkout is the development source of truth. JSONL remains an
explicit rollback mode; switching stores must never migrate, rewrite, or delete
data from the other backend.

## Guardrails

- Treat `/home/ubuntu/pi-coding-agent` as a separate repository. Do not edit or
  commit it from this goal loop. Consume a built CLI artifact from it and fail
  clearly when that artifact is absent or stale.
- Require Node.js 22.19 or newer for SQLite mode because the local agent uses
  `node:sqlite`. Do not add an npm SQLite driver.
- Resolve the store once in the stable server configuration and pass the same
  environment to every long-lived runner and one-shot pi subprocess.
- Do not represent a SQLite session as the bare `sessions.sqlite` path. Its
  identity is `{ backend: "sqlite", id, storagePath }`; multiple sessions share
  one database.
- Keep JSONL support working. Existing JSONL URLs and API payloads may be
  accepted as compatibility input, but new code must use backend-neutral
  session references internally.
- SQLite reads must tolerate WAL mode and concurrent pi writers. Keep database
  handles request-scoped or explicitly lifecycle-owned, close them reliably,
  use parameterized statements, and do not copy a live database for tests.
- Do not mutate SQLite tables directly for workflow operations such as fork or
  delete. Use a supported pi/repository operation. If the consumed local build
  cannot perform an operation safely, reject it before changing git/session
  state and expose the limitation in the UI.
- Preserve auth, route status codes where applicable, runner isolation, SSE
  continuity, hublot/routine session binding, and JSONL rollback behavior.
- Complete exactly one unchecked item per verified commit. For every item run:

```sh
npm test
```

Run the broader matrix stated in the final item only after the focused steps
pass.

## 1. Characterize and Configure the Local pi Contract

- [x] Add configuration tests and documentation for `PI_BIN`,
  `PERSISTENT_STORE=jsonl|sqlite`, and the SQLite database location. Default the
  development wiring to
  `/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js` plus
  `sqlite`, while retaining explicit overrides and a documented JSONL rollback
  command. Validate the executable, Node version, and store value at startup
  with actionable errors.
- [x] Add a deterministic process-contract test that launches the configured
  local CLI in RPC mode with a temporary agent/session directory and mock
  model, creates a SQLite session, restarts with `--continue`, and proves the
  same session ID and entries return without any session `.jsonl` file. Skip
  only when an explicitly documented local-pi test override is used; do not
  silently test the globally installed pi.

**Acceptance:** server startup and tests prove which pi executable and store are
in use, SQLite persistence survives an RPC process restart, and rollback to
JSONL is explicit.

## 2. Introduce Backend-Neutral Session References

- [x] Add a session-reference module that validates, compares, serializes, and
  parses JSONL and SQLite references. Use an opaque URL-safe session key for
  HTTP parameters and runner matching; reject malformed keys and database paths
  outside the configured agent/session location.
- [x] Change runner state and public runner info from file-only identity to a
  backend-neutral `sessionRef` plus compatibility `sessionFile` for JSONL.
  Start a resumed SQLite runner with `--session <id>` and the configured store
  instead of sending JSONL-only `switch_session`; preserve the reference across
  watchdog restarts and deduplicate runners by the full reference.
- [x] Update browser session actions, stores, picker view models, transcript
  loading, permalink lookup, and checkpoint-tree entry points to use the opaque
  session key/reference rather than assuming every persisted session has a
  `.jsonl` path. Keep compatibility tests for old JSONL links.

**Acceptance:** two SQLite sessions in the same database remain distinct in the
UI and runner manager, while existing JSONL session links still open.

## 3. Add a Read-Only SQLite Session Catalog

- [x] Split `sessions.mjs` behind a backend-neutral catalog interface and move
  the current parser into a JSONL catalog without changing its behavior or LRU
  guarantees. Add shared contract fixtures for summaries, headers, entries,
  active-branch messages, lookup, folders/workdirs, and search.
- [x] Implement the SQLite catalog with `node:sqlite` against a temporary copy
  created by the local pi process contract. Read session discovery metadata and
  decode ordered entry payloads into the same domain shape as JSONL; derive the
  active branch from `active_leaf_id`, preserve parent session IDs, and close
  handles deterministically. Add malformed-row and concurrent-WAL-read tests.
- [x] Select and lifecycle-manage the catalog from stable configuration, then
  make session list, lookup-by-ID, entries, messages, folders, and search routes
  backend-neutral. Keep response fields needed by existing clients while adding
  `sessionKey` and `sessionRef` as the canonical identity.

**Acceptance:** the session picker, preview, search, permalink anchors, and
transcript hydration expose equivalent user-visible data for JSONL and SQLite.

## 4. Make Session Operations Safe in SQLite Mode

- [x] Route saved-session open/resume through backend-specific operations:
  JSONL retains `switch_session`, while SQLite starts or reuses a runner with
  `--session <id>`. Add restart, concurrent-session, cwd-switch, and stale-ID
  tests.
- [x] Add a backend-neutral delete operation. JSONL keeps confined unlink;
  SQLite must invoke a supported operation from the consumed local pi build,
  stop the matching runner first, and only then release hublots/routines and
  update clients. If that operation is unavailable, return a capability error
  without partial cleanup. Add success, failure, and cross-session isolation
  tests.
- [x] Refactor checkpoint recording and family-tree reads to consume session
  references and catalog entries. Preserve checkpoint anchors, parent/fork
  grouping, inherited markers, and routine/hublot bindings for SQLite session
  IDs.
- [x] Put rollback/fork behind an explicit backend capability. Keep the existing
  JSONL implementation; for SQLite invoke a supported exact-entry fork and
  attach the resulting session by ID. If the local build lacks exact-entry
  SQLite fork support, disable the control with a precise explanation and
  reject the route before `git reset --hard` or safety-checkpoint mutation.

**Acceptance:** supported SQLite operations are end-to-end safe, unsupported
operations fail before side effects, and no code unlinks or rewrites the shared
database as though it were one session.

## 5. Wire One-Shot Processes and Runtime Environment Consistently

- [x] Centralize pi subprocess creation so runners, checkpoint summarizers, and
  hublot agents all use the validated local executable and an explicit inherited
  store environment. Ensure `--no-session` helpers remain ephemeral and cannot
  create SQLite rows.
- [ ] Update startup logging, `/health`, and diagnostic output to report the pi
  executable, selected session backend, and database location without exposing
  tokens or credentials. Add tests proving diagnostics cannot claim SQLite
  while a JSONL/global pi process is running.

**Acceptance:** every pi subprocess comes from the intended checkout and uses
the intended persistence policy.

## 6. Make Local and Container Wiring Reproducible

- [ ] Update the systemd template and README commands to build the local
  coding-agent checkout, set `PI_BIN` and `PERSISTENT_STORE=sqlite`, restart the
  service, verify health, and roll back to JSONL. Document that SQLite backups
  require stopping pi writers or using SQLite's online backup API and include
  WAL/SHM files in stopped filesystem backups.
- [ ] Replace the Docker image's hard-coded published pi install with an
  explicit local-source build input (for example, a named BuildKit context),
  while retaining an intentional published-package fallback for release builds.
  Pin the selected source/version in image labels and verify the image uses
  Node 22 plus the SQLite-capable CLI.
- [ ] Extend the isolated Docker/e2e harness to enable SQLite, persist the agent
  directory on a volume, create a conversation, replace the container, resume
  it, and verify session picker/search/transcript behavior and absence of JSONL
  session files.

**Acceptance:** host and container instructions reproducibly run the same local
SQLite-capable pi rather than accidentally falling back to version `0.80.3`.

## 7. Complete Migration Validation and Documentation

- [ ] Add static guards forbidding new `.jsonl`/`sessionFile` identity
  assumptions outside the JSONL adapter and compatibility boundaries, bare
  `sessions.sqlite` identity comparisons, direct SQLite workflow mutations,
  and pi spawns outside the centralized launcher.
- [ ] Run the complete validation matrix below, perform a manual SQLite-to-JSONL
  toggle proving both stores remain intact, update README architecture and
  endpoint documentation, and check this item only after all results pass.

```sh
npm run build
npm test
docker build --build-context pi-source=/home/ubuntu/pi-coding-agent -t pi-lot-ui .
cd tests/e2e && npm test
```

## Completion Criteria

- pi-lot-ui launches the built CLI from `/home/ubuntu/pi-coding-agent` and
  reports `sqlite` as the selected backend.
- New conversations persist to `sessions.sqlite` and survive runner, server,
  and container replacement without creating session JSONL files.
- Session list, search, preview, transcript, permalink, and runner matching use
  database-plus-ID identity and distinguish sessions sharing one database.
- Delete and rollback/fork either use a supported backend operation completely
  or are rejected before any side effect; the shared database is never treated
  as a per-session file.
- JSONL remains a tested, documented rollback mode, and switching modes leaves
  both stores untouched.
- Unit, build, Docker, and e2e validation pass against the intended local pi
  source.
