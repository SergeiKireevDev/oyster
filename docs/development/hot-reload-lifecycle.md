---
title: Hot-reload lifecycle inventory
description: Mutations and resources currently affected while app.mjs initializes an application.
tags: architecture, hot reload, lifecycle
---

# Hot-reload lifecycle inventory

This is the baseline inventory of side effects performed by
`server/app.mjs:init(state)`. It describes the current implementation; it does
not imply that these effects are safe during candidate construction. Several
operations below affect the active generation before `server/server.mjs` swaps
its `app` reference.

## Dependency ownership classification

The lifecycle uses four mutually exclusive ownership classes. The class names
are machine-checked on every stable-state entry in
`server/persistence/stateInventory.mjs`; they describe resource ownership, not
data durability.

| Class | Owner and reload rule | Dependencies |
| --- | --- | --- |
| **stable** | The stable core owns the value for the process lifetime. Candidates may use it but must neither replace nor dispose it. Process shutdown is its cleanup path. | `appStore`, `appSettings`, repositories, runner/routine/hublot process records and handles, SSE clients, OAuth flow registry, reconciliation state, broadcast/event functions, runtime caches, and supervisor. This is the default for the stable-state inventory. |
| **candidate-owned** | One application generation constructs and exclusively uses the value. Candidate failure or retirement must dispose it idempotently; it must not overwrite the active generation's value during construction. | Route table and request context; credential, OAuth, checkpoint, deletion, restart, runner, session-operation, process-launcher, owner, and reference services; selected session catalog; watchdog/reaper timers; and returned request/shutdown closures. The current implementation temporarily stores the catalog, catalog key, process launcher, session-operation/reference services, and runner timers on `state`; their `candidate-owned` inventory metadata records this ownership mismatch for the transactional refactor. |
| **shared-immutable** | The stable core may pass the same frozen/read-only value to every generation. There is no cleanup and candidates must not mutate it. | Validated `state.config`, imported constants such as `SESSIONS_ROOT`, and stateless module function exports used to construct candidate services and routes. |
| **restart-required** | The process bootstrap owns the dependency and cannot replace it through an application swap. A source or configuration change requires a clean process restart. | Listening HTTP socket, filesystem watchers and reload debounce timer, signal subscriptions, environment selection, application-store construction/migrations, and stable-state construction/assertion. `server/server.mjs` closes the socket and application store during process shutdown; Node tears down watchers and signal subscriptions on exit. |

All cache-busted modules imported by `init()` are construction inputs, not
long-lived owners. Their stateless exports are shared-immutable within that
candidate build; objects and closures produced from them are candidate-owned.
Stable dependencies are injected through `state` and remain owned by
`server/server.mjs`. In particular, a candidate may call repositories but does
not own their SQLite connection.

The stable-state inventory test enforces the field-level exceptions:
`config` is `shared-immutable`; `sessionCatalog`, `sessionCatalogKey`,
`sessionReferences`, `piProcesses`, `sessionOperations`,
`runnerWatchdogTimer`, and `runnerReaperTimer` are `candidate-owned`; every
other inventoried field is `stable`. Restart-required process dependencies are
intentionally not fields available to `app.mjs`.

## Candidate application contract

The reloadable composition root will expose a construction function with this
conceptual JavaScript interface (the names are normative even though the
current `init()` has not yet been migrated):

```js
/**
 * @typedef {object} ApplicationCandidate
 * @property {() => Promise<void>} activate
 * @property {(req: import("node:http").IncomingMessage,
 *   res: import("node:http").ServerResponse) => Promise<void>} handleRequest
 * @property {() => Promise<void>} dispose
 */

/** @returns {Promise<ApplicationCandidate>} */
export async function buildCandidate(stableDependencies) {}
```

`buildCandidate()` performs **side-effect-free construction**. It may import a
coherent module generation, validate dependencies and routes, create plain
objects and closures, and prepare an initially empty disposable scope. It must
not write or delete stable-state fields, write repositories, start or signal a
process, open a catalog handle, install an event listener, or schedule a timer.
It must not close anything supplied through `stableDependencies`. The returned
object starts in the `constructed` phase and is not eligible for request
dispatch.

`activate()` is the only phase allowed to acquire candidate-owned resources. It
registers every acquired cleanup in the candidate's private disposable scope
before exposing the resource, and resolves only when the candidate is ready to
serve. It does not swap the stable core's active handler; the stable core owns
that single assignment after activation succeeds. Calling `handleRequest()` is
valid only in the `active` phase. The method captures this candidate's immutable
route table and request context; it must not consult a mutable global “current
candidate”. Each request retains the candidate generation it entered until its
promise settles.

`dispose()` retires the candidate. It is asynchronous and idempotent: all calls
return the same completion result, candidate-owned cleanups run at most once in
reverse acquisition order, and a call on a merely constructed or partly
activated candidate is valid. Disposal prevents new requests and waits for the
candidate's already-entered request count to reach zero before closing
request-visible resources. Stable and shared-immutable dependencies are never
closed by this method. After disposal, `activate()` and `handleRequest()` reject
with a lifecycle error. Process shutdown disposes the active candidate first,
then the stable core follows its own cleanup paths below.

The stable core, not a candidate, owns the lifecycle transition:

```text
constructed --activate()--> active --stable-core swap--> serving
     |                           |                            |
     +-------dispose()-----------+----------dispose()---------+
                                                            disposed
```

There is exactly one stable-core `activeApplication` reference. A candidate
never assigns it and no route reads it.

## Failure and concurrency semantics

A reload has one commit point: the stable core's single, synchronous,
non-throwing assignment to `activeApplication`. Everything before that
assignment is **pre-swap**; everything after it is **post-swap**. Generation
identifiers are monotonic and are allocated before import, so diagnostics can
identify failed candidates without making them active. The stable core records
whether the commit point was crossed instead of inferring that fact from which
later operation threw.

| Failure phase | Active application and required cleanup | Observable result |
| --- | --- | --- |
| Import | The old application remains active. No candidate exists, so no candidate cleanup runs. | Emit authenticated `code_reload_failed` diagnostics with `phase: "import"`, the attempted and active generations, and `committed: false`. Do not retry until a later filesystem change. |
| Construction | The old application remains active. `buildCandidate()` must catch its own partial-construction failure and dispose its private staging scope; if it returned a candidate, construction succeeded. It must never clean up stable dependencies. | Emit `code_reload_failed` with `phase: "construction"` and `committed: false`. Report a staging-cleanup error as additional diagnostic detail without replacing the construction error. |
| Activation | The old application remains active. The stable core invokes and awaits the failed candidate's idempotent `dispose()`; only that candidate's acquired resources are eligible for cleanup. | Emit `code_reload_failed` with `phase: "activation"` and `committed: false`. A candidate cleanup failure is also reported and queued for bounded cleanup retry, but cannot retire or degrade the old application. |
| Swap | Route/dependency validation and every potentially throwing hook must finish before the commit point. If a precondition fails, this is a pre-swap failure and the activated candidate is disposed as above. The assignment itself has no callback or await. Once the reference changed, the new application is authoritative even if subsequent bookkeeping fails; rollback is forbidden. | Before assignment, emit `code_reload_failed` with `phase: "swap"` and `committed: false`. After assignment, emit `code_reloaded` and a separate post-swap diagnostic for failed bookkeeping; never claim that old code is still serving. |
| Old disposal | The new application remains active and receives all newly admitted requests. Failure to drain or dispose the old application never rolls back to a partially retired generation. Failed cleanup remains stable-core-owned and is retried a bounded number of times; exhaustion is exposed through authenticated diagnostics as a resource leak. | The reload remains successful. Emit `code_reload_cleanup_failed` with `phase: "old_disposal"`, `committed: true`, both generations, attempt count, and a sanitized error. |

`code_reload_failed` is reserved for failures that leave the old generation
active. A post-commit failure must not flow into the pre-swap catch block.
Diagnostics are sent only over the existing authenticated server-event and
server-log paths; errors are sanitized and must not expose source text,
credentials, request data, or filesystem contents. Failure reporting itself is
best effort and never changes which application is active.

Request dispatch has its own linearization point. The stable HTTP callback
reads `activeApplication` once and immediately calls that generation's
`handleRequest()`. Request admission increments that candidate's entered-request
count synchronously, before the first `await`. Therefore a request belongs
entirely to either the old or new generation; it is never migrated, replayed,
or dispatched through a mixture of their routes and dependencies. Requests
admitted before the swap may finish normally on the old generation while new
requests use the new generation. Old disposal first rejects further admission,
then waits for its entered-request count to become zero before closing any
request-visible candidate resource.

A request failure is not a reload failure. The selected generation decrements
its entered-request count in `finally`, including on request abort and handler
rejection. The stable HTTP error boundary sends one generic `500` response when
headers have not been sent, otherwise safely ends the response; it does not
retry the request, swap applications, or dispose either generation. Disposal
failure is likewise never delivered through an already executing request.

Process shutdown serializes with reload: once shutdown begins, it rejects new
candidate builds, disposes any uncommitted candidate, drains and disposes the
single active application, and then runs stable-core cleanup. If a swap already
crossed its commit point, shutdown treats the new generation as active and the
old generation only as pending retirement.

## Resource owner and cleanup registry

This registry is normative for the candidate refactor. “Current location”
records known mismatches without transferring ownership to `state`.

| Resource | Owner | Acquisition / current location | Sole cleanup path |
| --- | --- | --- | --- |
| Candidate route table and request context | candidate generation | side-effect-free construction | become unreachable after `dispose()` drains entered requests |
| Selected session catalog and its read-only database handles | candidate generation | `activate()`; currently replaced by `init()` through `state.sessionCatalog` | candidate `dispose()` calls `close()` once after request drain; each catalog operation still closes its short-lived handle |
| Session reference, process-launcher, session-operation, credential, checkpoint, deletion, restart, and owner service facades | candidate generation | plain construction; several currently stored on stable state | no resource cleanup; become unreachable after candidate disposal |
| Runner watchdog and reaper intervals | candidate generation | `activate()`; currently `createRunnerManager()` replaces timers on stable state | candidate `dispose()` calls `clearInterval()` once for each timer |
| HTTP request listeners and bodies | entered request | route dispatch | request completion/abort removes request-scoped listeners; disposal waits for the entered request |
| Open SSE response and its request `close` listener | stable core connection registry | open route adds the response to `state.sseClients` | request `close` removes the listener and response; process shutdown ends remaining responses |
| Runner child, readline `line`, stderr `data`, child `error`/`exit` listeners, and resume/restart timeouts | stable runner runtime record | runner operations, not candidate activation | runner stop/exit removes listeners and clears timeouts; stable-core process shutdown stops remaining runners |
| Routine children and stream listeners | stable routine runtime record | routine operations | routine stop/exit removes listeners; stable-core process shutdown stops remaining routines |
| Hublot service/tunnel children and child `error`/`exit` listeners | stable hublot handle registry | tunnel operations and startup recovery | tunnel close/exit removes listeners; stable-core process shutdown stops pool, supervisor, services, and tunnels |
| Hublot supervisor interval, startup reconciliation task, and tunnel-pool refill task/queue | stable hublot runtime | stable-core startup/recovery; currently scheduling is reached from `init()` | stable hublot shutdown stops the interval/pool and awaits or invalidates tasks before store shutdown |
| OAuth registry, flow abort listeners, inactivity timers, and retention timers | stable OAuth runtime | OAuth request operations | flow completion/shutdown removes abort listeners and clears timers; stable-core process shutdown aborts remaining flows |
| SSE broadcast function and server-event serializer | stable core | process startup or legacy migration | no acquired resource; process lifetime |
| Application-store SQLite connection and repositories | stable core | process startup | stable-core process shutdown, after candidate and process-facing services stop |
| Listening HTTP socket | stable core | process startup | stable-core process shutdown |
| Filesystem watcher and reload debounce timer | stable core | process startup | watcher close and timer clear during stable-core shutdown/process exit |
| Signal subscriptions | stable core | process startup | stable-core shutdown removes subscriptions/process exit |

Every timer and event listener not listed here is request- or operation-created
and must be attached to one of the listed owner records at creation time. Adding
a new long-lived timer, listener, catalog/database handle, or process-facing
service requires adding its owner and one cleanup path to this registry and to
the lifecycle inventory test.

## Direct stable-state mutations

These are all writes spelled directly in `init()`. The field names are checked
against the source by `tests/app-init-mutation-inventory.test.mjs`.

| Stable field | Condition | Mutation |
| --- | --- | --- |
| `state.eventBuffer` | Legacy field exists | Deleted. |
| `state.broadcast` | Legacy field exists | Replaced with an SSE writer closure over `state.sseClients`. |
| `state.sessionCatalog` | Catalog key changed | The previous catalog is closed and the selected JSONL or SQLite catalog replaces it. |
| `state.sessionCatalogKey` | Catalog key changed | Replaced after the new catalog is constructed. |
| `state.sessionReferences` | Every init | Replaced with a new session-reference codec. |
| `state.piProcesses` | Every init | Replaced with a new process-launcher service. |
| `state.hublotSupervisor` | Missing only | Initialized with a supervisor whose callbacks close over the current module generation. |
| `state.sessionOperations` | Every init | Replaced with a new session-operation service. |
| `state.sessionDeletionReconciliation` | First reconciliation only | Set to the reconciliation report. |
| `state.incompleteOperations` | First reconciliation only | Rehydrated from the application store after reconciliation. |
| `state.sessionDeletionReconciled` | First reconciliation only | Set after reconciliation succeeds. |
| `state.oauthFlows` | Missing only | Initialized to the process-owned OAuth flow registry. |

Route tables, request context, credential/checkpoint/session-owner services, and
HTTP handler closures are local values returned or captured by this generation;
their construction does not directly write another stable-state field.

## Delegated mutations and resource effects

`init()` invokes constructors and schedulers that mutate stable state,
persistence, timers, event subscriptions, or process-facing resources.

### State patching and catalog replacement

The legacy patch deletes `state.eventBuffer` and installs `state.broadcast`.
The broadcast closure writes each currently open response in
`state.sseClients`; it does not add or remove clients.

When the catalog key changes, `state.sessionCatalog.close()` runs before a new
catalog is installed. The JSONL catalog is a shared module object with a no-op
close; the SQLite catalog owns read-only database handles opened by its
operations and `close()` closes any remaining handles. Catalog replacement is
the only explicit cleanup path; final process exit releases anything still
open because the returned application has no catalog-stop closure.

### Session deletion reconciliation

`reconcileSessionDeletions()` may update operation and session repositories,
close session hublots, and delete session routines. It runs before route
construction and before the handler swap. The three
`state.sessionDeletionReconciliation`, `state.incompleteOperations`, and
`state.sessionDeletionReconciled` fields record and guard the one-time work.
A failed reconciliation leaves the reconciled flag false so a later init can
retry.

### Runner manager creation and timers

`createRunnerManager()`:

- creates or hydrates `state.runners` and adds missing runtime fields to entries;
- may mark persisted runners interrupted and repair `state.defaultRunnerId`
  plus the corresponding application setting;
- sends `SIGTERM` to the legacy `state.pi` process, clears that field, and
  removes its legacy compatibility state;
- clears and replaces `state.runnerWatchdogTimer`; and
- clears and replaces `state.runnerReaperTimer`.

The manager owns the replacement watchdog and reaper intervals through stable
state. Reinitialization clears them before replacement. They are unreferenced,
but `stopPi()` does not clear them; final process exit is their only cleanup if
there is no later initialization.

Manager construction itself does not subscribe to a live runner process. A
later runner start attaches readline `line`, stderr `data`, child `error`, and
child `exit` subscriptions. Those listeners are retained on the process and its
runner record, and are removed or made unreachable when `stopPi()` terminates
and clears the runner process resources. Resume/restart timeouts are likewise
created by runner operations after initialization, not by `init()` itself.

### Supervisor scheduling and tunnel pool

`scheduleHublotStartupReconciliation()` stores
`state.hublotStartupReconciliationTask`, later updates
`state.hublotStartupReconciliation` and `state.hublotStartupReconciled`, and
clears the task field on completion. It calls
`state.hublotSupervisor.start()`, which idempotently owns one internal interval.
Reconciliation can update hublot/process records and invoke service or tunnel
recovery callbacks.

After reconciliation, `ensureHublotTunnelPool()` can update
`state.hublotTunnelPoolQueue`, `state.hublotTunnelPoolRefillTask`,
`state.hublotTunnelPoolRefillRequested`, and
`state.hublotTunnelPoolStopping`. It can update hublot records, spawn
cloudflared processes, attach process `error`/`exit` subscriptions, and add
handles to `state.hublotProcessHandles`. `stopTunnels()` stops the pool and the
supervisor interval, removes process listeners through tunnel shutdown, and
terminates the hublot processes.

### OAuth service and timers

`createPiOAuthFlowService()` receives the stable `state.oauthFlows` registry.
Construction starts no timer and installs no external event listener. OAuth
requests later add abort callbacks plus inactivity and retention timers to flow
records. The returned `stopOAuth()` calls the service's `shutdown()`, which
aborts active flows and clears their timers.

### Other process-facing services

`createPiProcessLauncher()` and `createSessionOperations()` only construct
facades during `init()`; they start no process, timer, or listener at
construction. Later runner and session operations use those facades. The route
factories and credential, checkpoint, deletion, and restart services similarly
capture dependencies without acquiring a lifecycle resource during init.

## Returned closure and cleanup paths

The application object returned by `init()` exposes the following process
shutdown paths:

- `stopPi()` stops runner processes, clears runner resume timers, and replaces
  each process's exit listener for shutdown reporting; it does not clear the
  runner-manager intervals;
- `stopTunnels()` stops the tunnel pool and supervisor, then shuts down hublot
  services and tunnels;
- `stopRoutines()` stops all routine child processes; and
- `stopOAuth()` aborts OAuth flows and clears their timers.

`server/server.mjs` invokes these functions during clean process shutdown. It
does **not** currently dispose the previous application after a successful
hot-reload swap. Consequently, catalog replacement and runner timer replacement
happen during the next `init()`, while other generation-captured closures have
no hot-reload retirement path. That gap is recorded here for later
transactional lifecycle work.
