# Svelte Migration: Remaining Orchestration

## Goal

Reduce `public/src/legacy.js` to a small transport adapter while preserving the
current behavior: durable file-backed transcript history, best-effort SSE
updates, session switching, RPC/API contracts, and transcript scroll behavior.

This is an incremental extraction plan, not a rewrite. Each phase must keep the
existing DOM IDs/selectors and run the full validation suite before commit.

## Guardrails

- Keep `legacy.js` as the initial owner of the live Pi RPC connection and SSE
  `EventSource`; do not move transport and UI rendering in the same change.
- Treat session `.jsonl` files as durable completed history. SSE and
  `get_messages` remain live/reconciliation sources only.
- Preserve tail-first transcript loading, cancelled-render protection, pinned
  scroll behavior, checkpoint placement, and current e2e selectors.
- Keep host-reload-surviving server state on the server-owned state object.
- Make one extraction per commit. Do not combine cleanup with behavior changes.

## 1. Document the Existing Ownership Boundary

1.1. ✅ Added a concise ownership map near the `legacy.js` imports:

- transport: RPC request/response correlation, SSE connect/reconnect;
- session lifecycle: runner selection, state hydration, transcript reload;
- transcript actions: item construction/backfill modules and scroll callbacks;
- Svelte stores: visible UI state and component rendering;
- API actions: checkpoints, hublots, routines, file/browser operations.

1.2. ✅ Classified bridge export groups: menu/session/browser/hublot/routine/
command-palette/settings handlers are temporary DOM-event adapters; checkpoint
rollback is a temporary API adapter; none are direct store operations yet.

**Acceptance:** no behavior change; the ownership map accurately matches imports
and event listeners.

## 2. Extract a Session Lifecycle Action Module

✅ Created `public/src/lib/sessionActions.js` with dependency-injected actions
for applying `get_state` results, selecting/switching runners, replay-gate
decisions, and session-root-relative file queries. The module receives callback
hooks and does not import legacy code.

Connection creation, `EventSource` ownership, and RPC implementation remain in
`legacy.js`.

**Acceptance:** deliberate session switches use `connect({ replay: false })`;
fresh empty sessions do not wait on transcript replay; model/session restoration
e2e coverage remains green.

## 3. Extract Transcript Reload/Reconciliation Actions

✅ Created `public/src/lib/transcriptReloadActions.js` for canonical request
coordination and durable-history reconciliation. It eagerly applies state,
uses injected session-file reads as the primary completed history, and falls
back to `get_messages` if durable history is unavailable.

Request issuance, SSE registration, lifecycle logging destination, and scroll
DOM measurements remain in `legacy.js`. Render-job cancellation and tail-first
rendering stay in the transcript action modules.

**Acceptance:** a refresh and session switch show completed file transcript
history even if live SSE is unavailable; live streaming does not duplicate a
completed assistant message.

## 4. Move API Operations into Focused Action Modules

Extract API-facing orchestration one domain at a time. Each module receives an
injected `rpc` function and store/UI callbacks, and returns promises with
explicit result/error values.

Suggested order:

4.1. ✅ `checkpointActions.js`: extracted checkpoint creation and rollback
requests. Model selection and marker refresh remain legacy UI orchestration;
component busy/frozen display remains in existing stores.

4.2. ✅ `hublotActions.js`: extracted list/close request handling. Opening and
manager UI orchestration remain legacy-owned pending a concrete bridge reduction.

4.3. ✅ `routineActions.js`: extracted list and lifecycle request handling
(create/start/stop/teardown/status). Store refresh/error presentation remains
legacy-owned.

4.4. ✅ `fileBrowserActions.js`: extracted File Explorer browse, read, and save
requests. Download/upload operations and picker reuse remain legacy-owned until
their response contracts can be extracted without combining UI changes.

**Acceptance:** each extraction preserves existing response contracts and e2e
coverage. Do not extract two domains in one commit.

## 5. Replace Legacy DOM Event Wiring with Component Actions

For each remaining top-level `addEventListener` in `legacy.js`:

- prefer a Svelte component handler that calls a focused action module;
- retain a custom DOM event only where a legacy-owned transport action is still
  required;
- remove the corresponding `legacyBridge.js` export/import once unused.

Prioritize events owned by already-migrated components before touching global
keyboard handling or transcript scroll listeners.

✅ Hublot sidebar and manager close controls now call `hublotActions.js`
directly; their legacy bridge exports and handlers were removed. Routine and
file-browser bridge actions remain pending because their direct replacements
must preserve session-scoped refresh behavior.

**Acceptance:** every removed bridge symbol has no references under
`public/src`, and `tests/ui-page.test.mjs` continues to validate all legacy DOM
references.

## 6. Narrow the Transport Adapter

After session and API action extraction, reduce `legacy.js` to:

- RPC request/response plumbing;
- SSE connect/reconnect and event dispatch;
- session bootstrap coordination;
- unavoidable DOM-level concerns (`#messages` scroll measurements and document
  keyboard/global events) until those have a safe store/action replacement.

Convert SSE event handlers into a dispatch table that calls imported action
functions. Keep deduplication (`_sseId`) and replay ordering intact.

**Acceptance:** no Svelte component prop construction, modal rendering, or
feature-specific API workflow remains in `legacy.js`.

## 7. Add Focused Regression Tests During Extractions

Add unit tests for pure/action-module decisions where practical:

- replay-needed decisions for new, existing, and switched sessions;
- durable transcript versus optional reconciliation behavior;
- ✅ API action success/error normalization (checkpoint, routine, hublot, and file-browser action contracts);
- SSE event dispatch/deduplication helpers if extracted as pure functions.

Keep existing browser e2e tests as the contract for transcript scrolling,
session switches, checkpoint rollback, hublots, routines, and file browsing.

## 8. Validation and Commit Cadence

For every completed phase or single-domain extraction:

```sh
npm run build
npm test
docker build -t pi-lot-ui .
cd tests/e2e && npm test
```

Refresh persistent test containers after image rebuilds. Commit only passing
changes with a focused message, for example:

```text
Extract session lifecycle actions
Extract durable transcript reload actions
Move checkpoint RPC workflow into actions
Remove obsolete hublot legacy bridge
```

## Completion Criteria

The migration is complete when:

- `legacy.js` is a transport/bootstrap adapter rather than the UI feature hub;
- Svelte components call stores and focused action modules directly;
- `legacyBridge.js` only contains unavoidable compatibility adapters, or is
  removed;
- file-backed transcript history and live SSE behavior remain independently
  reliable;
- all unit, Docker, and e2e validation passes.
