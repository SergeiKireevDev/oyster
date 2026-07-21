# Split the Hot-Reloadable HTTP Application

## Goal

Reduce `app.mjs` from a monolithic router into small, hot-reloadable HTTP route
factories while preserving atomic handler swaps, durable state ownership in
`server.mjs`, and live SSE connections across reloads.

## Non-negotiable reload contract

- `server.mjs` remains the only owner of the listening socket, child-process
  references, runner/tunnel/routine state, SSE responses, replay buffers, and
  configuration.
- `app.mjs` and every extracted route module are disposable construction code:
  they receive `state` and a request context and may not retain new durable
  state in module scope.
- A failed import, factory call, or route-table validation keeps the previously
  active handler installed.
- Reloading request code must not disconnect existing SSE clients or duplicate
  runner/SSE listeners.
- All public route paths, auth behavior, status codes, response shapes, and
  filesystem confinement behavior remain unchanged.

## Validation for every verified item

```sh
npm run build
npm test
docker build -t pi-lot-ui .
cd tests/e2e && npm test
```

## 1. Characterize the Existing Reload Boundary

- [ ] Add an integration test that starts the stable server core with a
  temporary hot-reloadable application fixture, makes a request through the
  active handler, reloads successfully, and verifies the replacement handler
  serves the next request.
- [ ] Extend that fixture test with an intentionally invalid replacement module
  and verify the previous successful handler still serves requests and the
  reload-failure event is emitted.
- [ ] Extend the fixture test with an open SSE response, reload the request
  handler, and verify the response remains writable and receives a subsequent
  state-owned broadcast.

**Acceptance:** tests describe atomic success/failure swaps and SSE continuity
before route code moves.

## 2. Establish Route-Factory Infrastructure

- [ ] Add `http/createRouteTable.mjs`, which merges named route maps and throws
  on duplicate method/path keys. Add unit tests for merge order, duplicate
  rejection, and handler lookup.
- [ ] Add `http/createRequestContext.mjs` containing only reusable HTTP helpers
  currently in `app.mjs`: JSON/text responses, JSON body parsing, MIME lookup,
  auth/token comparison, rate-limit checks, and safe path resolution. Preserve
  current status codes and add focused contract tests for each helper.
- [ ] Change `app.mjs` to construct the request context and route table through
  these factories without moving any route handler. Keep the existing handler
  behavior and add a regression test for open-route versus authenticated-route
  dispatch.

**Acceptance:** route factories have an explicit context interface and route
collisions fail during construction, before a handler swap.

## 3. Extract Open and Static Routes

- [ ] Move `GET /health` and `GET /authcheck` into
  `http/routes/openRoutes.mjs`, preserving their unauthenticated behavior and
  reload-count response contract.
- [ ] Move UI document serving (`/` and `/s/<sessionId>[/m/<entryId>]`) and
  public asset serving into `http/routes/staticRoutes.mjs`. Preserve traversal
  rejection, Vite output behavior, cache headers, and MIME types with tests.
- [ ] Remove the extracted open/static route code from `app.mjs`; compose both
  factories through the route table and run no-reference checks for their old
  helpers.

**Acceptance:** `app.mjs` contains no static-file or open-route handler bodies.

## 4. Extract Runner, SSE, and RPC Routes

- [ ] Move `GET /events` into `http/routes/runnerRoutes.mjs`, injecting runner
  lookup, state-owned SSE client registration, replay behavior, and disconnect
  cleanup. Add reconnect and reload-continuity tests.
- [ ] Move `POST /rpc`, `GET /runners`, `DELETE /runners`, `POST /restart`, and
  `POST /open-session` into the same factory. Preserve runner selection,
  authorization, error normalization, and state broadcasts in tests.
- [ ] Remove the extracted runner route bodies from `app.mjs` and verify runner
  startup/shutdown functions remain exported by the composed application API.

**Acceptance:** runner/SSE route code is isolated while all durable runner and
SSE state remains state-owned.

## 5. Extract Session Routes

- [ ] Move session listing, deletion, lookup-by-ID, entries, messages, and
  folder-list routes into `http/routes/sessionRoutes.mjs`. Preserve workdir
  scoping, session-root traversal rules, and response shapes with existing or
  new API tests.
- [ ] Move `GET /search` into the session route factory, preserving scope,
  tool-output filtering, snippets, and error behavior with search contract
  tests.
- [ ] Remove extracted session route bodies from `app.mjs` and verify route
  factory dependencies are injected rather than imported from application
  module state.

**Acceptance:** session/file-history HTTP behavior is owned by one route
factory, not the composition root.

## 6. Extract Filesystem and Workdir Routes

- [ ] Move directory browse and mkdir routes into `http/routes/fileRoutes.mjs`.
  Preserve configured-root confinement, hidden-file behavior, and status codes
  with traversal and mkdir tests.
- [ ] Move file download, content, save, and chunked upload routes into the
  file route factory. Preserve token checks, atomic writes, upload offset
  idempotency, size limits, and path-confinement tests.
- [ ] Move `POST /workdir` into `http/routes/workdirRoutes.mjs`, injecting only
  the runner manager/state operations it requires. Preserve runner switch and
  broadcast behavior with a contract test.
- [ ] Remove extracted filesystem/workdir route bodies from `app.mjs` and run a
  no-reference check for old inline path and upload helpers.

**Acceptance:** all filesystem mutation and workdir HTTP policy is isolated in
route factories with confinement tests.

## 7. Extract Tunnel and Routine Routes

- [ ] Move all tunnel list/create/rebind/delete routes into
  `http/routes/tunnelRoutes.mjs`. Preserve session binding, state-owned process
  handles, hublot-agent spawning, and event broadcasts with lifecycle tests.
- [ ] Move routine list and action routes into `http/routes/routineRoutes.mjs`.
  Preserve create/run/stop/teardown/release/delete validation, session binding,
  progress events, and teardown behavior with contract tests.
- [ ] Remove extracted tunnel/routine route bodies from `app.mjs`; keep
  `stopTunnels()` and `stopRoutines()` exposed through the composed app API for
  stable-core shutdown.

**Acceptance:** tunnel/routine routes are independently reloadable without
moving their durable process state out of `state`.

## 8. Extract Checkpoint Routes

- [ ] Move checkpoint create/list/tree routes into
  `http/routes/checkpointRoutes.mjs`. Preserve runner/session validation, model
  summary options, checkpoint persistence, and response contracts with tests.
- [ ] Move rollback route handling into the checkpoint factory. Preserve dirty
  worktree checkpointing, fork/session creation, runner opening, and broadcast
  behavior with rollback API tests.
- [ ] Remove checkpoint route bodies from `app.mjs` and verify the factory
  receives all git/session/runner operations explicitly through its context.

**Acceptance:** checkpoint HTTP orchestration is isolated without changing git
or session-fork semantics.

## 9. Make Every Route Module Hot-Reloadable

- [ ] Replace `app.mjs` route-factory imports with cache-busted dynamic imports
  using the existing mtime strategy. Add a test proving a changed route factory
  is observed after an application reload rather than served from Node's ESM
  cache.
- [ ] Change `server.mjs` watching to reload when `app.mjs`, `http/`, or an
  extracted route-factory dependency changes. Watch directories so atomic-save
  rename behavior remains safe; debounce one reload per change burst.
- [ ] Add a route-factory reload integration test that changes a temporary
  route module, confirms the new response is served, and confirms an existing
  SSE client remains connected.
- [ ] Document that cache-busted hot reload is a development/runtime recovery
  feature and that production deployments use process replacement, avoiding
  unbounded long-lived ESM cache growth.

**Acceptance:** editing any route module triggers an atomic request-handler
swap without a manual `app.mjs` touch.

## 10. Finish the Composition Root and Prove Behavior

- [ ] Reduce `app.mjs` to dynamic domain imports, request-context construction,
  route-factory composition, auth dispatch, and the stable-core lifecycle API.
  Remove stale inline helpers, route comments, and imports after no-reference
  checks.
- [ ] Add a static architecture test that forbids method/path route literals
  and direct Node filesystem/process imports in `app.mjs`, except explicitly
  documented dynamic-loader dependencies.
- [ ] Run stale-reference checks and the complete validation matrix, then mark
  this final item complete only after all checks pass.

```sh
rg '"(GET|POST|PATCH|DELETE) /' app.mjs
rg 'from "node:(fs|child_process)"' app.mjs
rg 'createRouteTable|createRequestContext|http/routes' app.mjs server.mjs tests
```

## Completion Criteria

- `app.mjs` is a small, hot-reloadable composition root.
- Every HTTP domain has an importable route factory with injected dependencies.
- `server.mjs` owns all durable state and atomically retains the prior handler
  on reload failure.
- Editing an extracted route module reloads it without touching `app.mjs` and
  does not drop SSE clients.
- Route, security, filesystem, runner, checkpoint, tunnel, routine, build,
  unit, Docker, and e2e validation all pass.
