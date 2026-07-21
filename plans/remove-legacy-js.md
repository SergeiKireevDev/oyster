# Remove `public/src/legacy.js`

## Goal

Replace `legacy.js` with small, importable transport/session/action modules and
Svelte-owned event wiring. Preserve current behavior while eliminating the
single imperative feature hub.

This is a staged refactor. Do not delete `legacy.js` until all consumers have
moved and the replacement bootstrap is validated.

## Guardrails

- Keep durable session-file transcript history authoritative; SSE is a
  best-effort live overlay.
- Preserve deliberate runner switches with `connect({ replay: false })`,
  transcript replay gating, `_sseId` deduplication, tail-first rendering, and
  scroll correction.
- Keep browser-visible IDs/selectors until their component contracts change
  with matching tests.
- Move one ownership domain per commit and run:

```sh
npm run build
npm test
docker build -t pi-lot-ui .
cd tests/e2e && npm test
```

## 1. Create a Replacement App Runtime ✅

Create `public/src/runtime/appRuntime.js` as the temporary composition root.

- [x] Moved app startup behind an explicit `startAppRuntime()` composition root;
  `App.svelte` no longer imports `legacy.js` directly.
- [x] Added explicit teardown-capable runtime boundaries.
- [x] Deferred global event-adapter registration and carousel initialization
  until runtime start.
- [x] Deferred debug-hook registration until runtime start.
- [x] Deferred authenticated-fetch registration until runtime start.
- [x] Moved startup/teardown lifecycle composition into a runtime module
  consumed by this root (`f2c6b6f`; verification recorded in `445e007`).
- [x] Kept feature logic out of the initial bootstrap extraction.

**Acceptance:** application startup behavior is unchanged, with a small
bootstrap module replacing the direct `legacy.js` import.

## 2. Extract Transport Runtime ✅

Create modules for:

- `rpcClient.js`: request IDs, pending promises, command timeout/error
  normalization;
- `eventStream.js`: EventSource lifecycle, reconnect watchdog, `_sseId`
  deduplication, replay buffering, and event dispatch;
- `authClient.js`: token persistence, auth probe, and authenticated fetch.

Inject callbacks rather than importing feature modules cyclically.

**Acceptance:** reconnect, unauthorized handling, SSE replay, and tunnel
behavior remain covered by existing e2e tests.

## 3. Extract Session Runtime ✅

Expand `sessionActions.js` into a session runtime owning:

- runner list/current-runner persistence;
- runner open/stop and deliberate switching;
- session previews and session-root-relative transcript queries;
- `get_state` application and replay-gate decisions;
- current workdir/busy/usage synchronization.

Expose narrow methods to UI actions: `openSession`, `switchRunner`,
`refreshState`, and `openSessionAtSearchHit`.

**Acceptance:** session picker, model restoration, preview, transcript,
new-session, and stop-session e2e tests pass.

## 4. Extract Transcript Runtime ✅

Combine transcript-specific orchestration into `transcriptRuntime.js`:

- durable session-file reload and optional live reconciliation;
- tail-first render scheduling and render-job cancellation;
- streaming assistant assembly and tool-card completion;
- permalink focus, checkpoint marker refresh triggers, and scroll callbacks.

Keep transcript items/components/store ownership unchanged. The runtime must
receive DOM scroll adapters and checkpoint callbacks through dependency
injection.

**Acceptance:** no transcript component props are assembled outside transcript
actions/runtime; scrolling, streaming, checkpoints, and permalinks remain
covered.

## 5. Extract Feature Controllers ✅

Move remaining imperative feature workflows into focused controllers, each
called by direct component events or Svelte stores:

- `fileExplorerController.js` and `filePickerController.js`;
- `folderBrowserController.js`;
- `sessionPickerController.js`;
- `hublotController.js` and `routineController.js`;
- `checkpointController.js` and `checkpointTreeController.js`;
- `commandController.js` and `settingsController.js`.

Controllers may depend on transport/session runtime interfaces, never on the
old `legacy.js` module.

**Acceptance:** move event listeners from `legacy.js` to controllers/runtime
registration one domain at a time; maintain RPC and extension UI contracts.

## 6. Move Global DOM Events into Svelte or Runtime Adapters ✅

Classify each remaining `document`/`window` listener:

- [x] Moved component-local rendering/events into their owning Svelte components.
- [x] Extracted lifecycle/global adapters and focused SSE event controllers for
  runner exit/unhealthy, Pi errors/restarts, reload notices, response refresh,
  hublots, routines, and runner lists.
- [x] Moved the `extension_ui_request` SSE branch into
  `createExtensionUiEventController()`.
- [x] Moved the `ping` runner-liveness SSE projection into
  `createRunnerPingEventController()`.
- [x] Moved the `replay_done` state-refresh SSE projection into
  `createReplayDoneEventController()`.
- [x] Classified the remaining `legacy.js` DOM event usage: no direct
  `document`/`window` listener registration remains; feature event adapters
  own their registration.

Avoid replacing one global imperative module with another untyped global event
hub.

**Acceptance:** custom event names are centralized and typed, or eliminated;
no feature-specific listener is left in the app composition root.

## 7. Reduce the Composition Root and Delete `legacy.js` ⏳

**Assessment (2026-07-13): in progress.** Steps 1–6 have left the feature
controllers/runtimes importable and removed direct `document`/`window` listener
registration from `legacy.js`. The recent lifecycle commits also extracted
runtime attachments, adapter registration, and teardown composition.

The deletion boundary has not yet been crossed: `appRuntime.js` still loads
`legacyRuntimeAdapter.js`, which dynamically imports `../legacy.js` for
`createLegacyRuntimeLifecycleDependencies()`. `legacy.js` is still 1,828 lines
and remains the place where the remaining dependency graph and lifecycle
objects are assembled. Its parse/DOM-ID guard still intentionally targets that
file. Therefore this step must remain incomplete.

Remaining work, broken into atomic commits:

- [x] **Characterize the current lifecycle seam.** Add/retain a focused test for
   `startAppRuntime()` proving attachment order is authenticated fetch → event
   adapters → debug hooks → boot, and that its disposer executes the current
   teardown sequence. This test must import only runtime modules, not
   `legacy.js`.
2. **Create an application composition factory.** Add
   `public/src/runtime/createAppRuntime.js`, exporting a factory that receives
   browser adapters (`window`, `document`, `location`, `history`, and DOM
   lookup) plus store actions. Do not import `legacy.js` from this factory.
3. **Move transport/session/transcript construction.** Move the module-level
   auth, RPC, EventSource, session, and transcript runtime construction from
   `legacy.js` into the factory. Preserve the existing injected callbacks,
   replay gate, `_sseId` dedupe, durable transcript reload, and scroll
   adapters. Test the factory with fake browser adapters.
4. **Move feature-controller construction.** Move construction and dependency
   wiring for checkpoint, composer/command, file/folder, hublot, routine,
   session-picker, settings, extension-UI, and carousel controllers into the
   factory. Keep each controller's event adapter as an explicit factory output
   rather than registering it while constructing the controller.
5. **Move lifecycle composition.** In the factory, compose the explicit
   `start`, `attachEventAdapters`, `attachAuthenticatedFetch`, debug-hook, and
   teardown functions using the existing lifecycle/attachment/cleanup modules.
   Export a `{ start, teardown }` runtime; no lifecycle dependency factory may
   remain in `legacy.js`.
6. **Switch the application entry point.** Change `appRuntime.js` to construct
   the new factory directly and delete `legacyRuntimeAdapter.js`,
   `legacyRuntimeDependencies.js`, `legacyRuntimeEventAdapters.js`, and
   `legacyRuntimeCleanup.js` only after their behavior is in a non-legacy
   runtime module. Verify no production module imports `legacy.js`.
7. **Delete the legacy module and retarget guards.** Delete
   `public/src/legacy.js`; update `tests/ui-page.test.mjs` so syntax and DOM-ID
   checks cover the replacement composition/runtime modules. Remove or rename
   legacy-named tests and files that no longer describe a live boundary.
8. **Prove completion.** Run the stale-reference check below (excluding only
   historical fixture names such as `*_legacy.jsonl`), then run the complete
   validation matrix from the guardrails.

```sh
rg "legacy\.js|legacy" public/src tests
```

## Progress Snapshot

- [x] Svelte owns visible rendering and local UI state.
- [x] Transport, session, transcript, feature, lifecycle, and stream-event
  domains have importable runtime/controller boundaries.
- [x] `legacy.js` no longer directly registers `document`/`window` listeners;
  focused event adapters own registration and teardown.
- [x] Lifecycle attachments, adapter registration, and teardown have narrow
  runtime modules with focused tests.
- [ ] Final dependency assembly remains in `public/src/legacy.js` (1,828
  lines), reached through `legacyRuntimeAdapter.js`.
- [ ] Move that assembly to `appRuntime.js`, remove the adapter/import chain,
  then delete `legacy.js` and retarget its guard tests.

## Completion Criteria

- `public/src/legacy.js` no longer exists.
- Startup is explicit and teardown-capable.
- Transport, session, transcript, and feature controllers have independent
  testable boundaries.
- Svelte components own local UI state/events; runtimes own transport and
  unavoidable global timing.
- Full build, unit, Docker, and e2e validation passes.
