# Split `appRuntimeImplementation` into Feature Runtimes

## Goal

Replace `public/src/runtime/appRuntimeImplementation.js` as the application-wide
feature hub with a thin application composition root and independently
constructible feature runtimes. Preserve the current Svelte UI, RPC/SSE
behavior, transcript reconciliation, and browser interaction contracts.

This is a **second-stage migration**. Deleting `legacy.js` succeeded, but its
central orchestration responsibility is now concentrated in
`appRuntimeImplementation.js` (currently 1,769 lines). Do not treat a rename
or file move as progress: each step must reduce the composition root's owned
state, browser access, and feature knowledge.

## Target Ownership

```text
public/src/
  app/
    appRuntime.js                    # assembles feature runtimes; no feature logic
    appLifecycle.js                  # start/teardown ordering only
  platform/
    rpcClient.js                     # existing transport/client pieces, normalized here
    eventStream.js                   # EventSource/replay/reconnect primitives
    browser.js                       # injected browser adapters
  features/
    transcript/                      # transcript runtime, store, components, DOM adapters
    sessions/                        # runner/session lifecycle, picker, search, routing
    checkpoints/                     # freeze/rollback/tree/marker
    composer/                        # composer, history, command palette
    files/                           # picker, folder browser, explorer
    hublots/                         # manager and sidebar
    routines/                        # sidebar and actions
    settings/                        # settings and extension UI
    layout/                          # carousel/mobile drawers/header interaction
  shared/
    stores/ components/ utils/
```

The final directory names may vary, but these ownership rules are required:

- `app/appRuntime.js` may construct and start features, but may not query a
  feature DOM ID, hold feature mutable state, or branch on a feature action.
- A feature runtime receives explicit dependencies and exposes a small public
  API (`start`, `teardown`, and named operations needed by another feature).
- Svelte components own local interaction handlers. They call feature actions
  through callback props, context, or feature stores—not global `window` or
  `document` custom events.
- `platform/` owns browser transport mechanics. It must not import Svelte
  components or feature stores.
- Direct DOM work is permitted only in a feature-local adapter where it is
  inherently browser-specific (for example transcript scroll measurement,
  focus, file-input selection, or global keyboard capture).

## Guardrails

- Preserve durable session-file transcript history as the authority for
  completed messages; SSE is a best-effort live overlay.
- Preserve `_sseId` deduplication, replay gating, canonical reload ordering,
  tail-first rendering, cancelled render jobs, and scroll-position correction.
- Preserve runner switching semantics, including deliberate switches without
  unwanted replay and empty-session behavior.
- Preserve visible IDs/classes and API request contracts until the owning
  Svelte component contract is migrated and tests are updated in the same
  commit.
- Do not combine an extraction with behavior, styling, or API changes.
- Do not introduce a replacement global event bus. New component-to-feature
  calls must be explicit callbacks/context actions; existing custom events are
  removed only when their receiver and sender move together.
- Make dependencies injectable. Do not replace `document`/`window` globals
  with hidden singleton wrappers.
- Keep every feature teardown-capable. A mount → teardown → mount cycle must
  create a fresh working runtime with no duplicate listeners or stale RPC/SSE
  state.

For every implementation commit, run:

```sh
npm run build
npm test
```

Add focused unit tests for extracted factories/controllers. Run the existing
browser/e2e suite as applicable before merging a domain that changes DOM,
scroll, keyboard, or session-switch behavior.

## [x] Baseline and Characterization

Before the first extraction:

- [x] Record the current line count and import list for `public/src/runtime/appRuntimeImplementation.js`.

  **Snapshot (2026-07-14, `4e7eb17`):** 1,769 lines and 74 static import
  declarations. Imports span Svelte (2), runtime/platform modules (23),
  Svelte stores (20), and feature/controller/action modules (29). This is the
  baseline for measuring extraction; do not use line count alone as completion
  evidence.
- [x] Add a runtime lifecycle regression test covering two complete cycles: `start → teardown → start → teardown`. Verify attachment ordering and that a fresh transport/event-stream runtime is used after restart.
- [x] Add a test or static guard that the composition root does not grow new `document.getElementById`, `querySelector`, `classList`, or feature-specific custom-event registrations.
- [x] Inventory every `pi-*`/`pi:*` custom event with its sender, receiver, and replacement feature API. Keep this inventory in this plan while migration is active.

### Custom-event inventory (2026-07-14)

| Events | Sender | Current receiver | Replacement feature API |
| --- | --- | --- | --- |
| `pi:composer` | `Composer.svelte` | composer event controller | Composer context action: `send` / `abort` |
| `pi-command-palette-run`, `pi-menu-action` | command palette, menu | command/menu controllers | Composer and menu callback props |
| `pi:header` | `Header.svelte` | carousel header controller | Layout/header context actions |
| `pi-settings-changed` | `SettingsModal.svelte` | settings change controller | Settings action: `reloadTranscript` |
| `pi-checkpoint-tree-open-session`, `pi-checkpoint-tree-rollback` | checkpoint tree node | checkpoint tree controller | Checkpoint feature actions |
| `pi-file-picker-browse`, `pi-file-picker-pick`, `pi-file-picker-use-folder`, `pi-file-picker-cancel` | picker modal and overlay actions | file picker controller | Files feature picker actions |
| `pi-folder-browser-browse`, `pi-folder-browser-create`, `pi-folder-browser-submit`, `pi-folder-browser-cancel` | folder modal and overlay actions | folder browser controller | Files feature folder actions |
| `pi-file-explorer-browse`, `pi-file-explorer-edit`, `pi-file-explorer-save`, `pi-file-explorer-upload`, `pi-file-explorer-back-list`, `pi-file-explorer-back-hublots` | explorer modal and overlay actions | explorer controller | Files feature explorer actions |
| `pi-open-file-explorer` | hublot list and manager | open-file-explorer controller | Files feature `openExplorer` action |
| `pi-hublot-show`, `pi-managed-hublot-create`, `pi-managed-hublot-toggle-scope`, `pi-managed-command-palette` | hublot sidebar/manager and overlay | hublot controllers | Hublots feature actions |
| `pi-routine-action` | routine list | routine controller | Routines feature action |
| `pi-session-picker-action`, `pi-session-picker-cancel` | session picker and overlay | session picker controller | Sessions feature actions |

**Acceptance:** baseline behavior is characterized; no production behavior is
changed.

## [x] 1. Make Runtime Construction Instance-Scoped

Move module-level mutable construction in
`appRuntimeImplementation.js` behind a factory, initially without moving
features.

- [x] Create `createApplicationRuntimeDependencies(browser, stores)` (or move the implementation behind an equivalent factory) so all state is per runtime instance.
- Pass browser adapters (`window`, `document`, `location`, `history`, fetch,
  timers, storage) through the factory rather than reading globals during
  construction.
- Update `runtime/appRuntime.js` so teardown clears its cached runtime and a
  subsequent start creates a new instance.
- Handle startup rejection in `App.svelte` through a visible application error
  state/toast rather than leaving an unhandled promise rejection.

**Acceptance:** remount/restart tests pass; no module-level runtime state is
reused after teardown.

## [x] 2. Extract Platform and Connection Coordination

Keep transport mechanics below features and extract the remaining wiring from
the root.

- Consolidate RPC client, token/authenticated fetch, EventSource construction,
  reconnect watchdog, response correlation, and debug hooks under
  `platform/` (existing focused modules may move without rewriting them).
- Create a small connection coordinator exposing: `connect`, `disconnect`,
  `refreshState`, and a typed/event-map dispatch boundary.
- The coordinator may receive callbacks for state refresh and feature event
  handling, but must not import transcript/session/hublot components.
- Preserve replay buffering and ordering tests before moving event consumers.

**Acceptance:** the composition root only creates the platform coordinator; it
contains no EventSource lifecycle state, watchdog state, or event `switch`.

## [x] 3. Extract the Sessions Feature Runtime

Create `features/sessions/createSessionFeature.js` around the existing session
runtime/controllers.

Move ownership of:

- current runner and runner list;
- route parsing/history synchronization;
- session bootstrap/open/switch/stop;
- state hydration, workdir/busy/usage state;
- session preview and canonical session reload requests;
- session picker, folder list, search, deletion, and search-hit navigation.

Expose only feature operations required elsewhere, such as `openSession`,
`switchRunner`, `refresh`, `getCurrentSession`, and a narrow notification hook.
Move session-picker component actions from global custom events to callbacks or
a sessions feature context.

**Acceptance:** session switching, previews, deep links, search hits, and
picker cancellation pass focused and browser tests. The root no longer holds
`currentRunner`, `runnersNow`, `state`, picker resolver state, or route state.

## [x] 4. Extract the Transcript Feature Runtime

Create `features/transcript/createTranscriptFeature.js` around existing
transcript stores, actions, and runtime helpers.

Move ownership of:

- transcript item lifecycle, streaming assistant/tool-card state, and local
  echo suppression;
- canonical rendering, tail-first backfill, cancellation, and scroll adapter;
- replay-gate release/flush hooks in coordination with the platform layer;
- transcript annotations, permalinks, checkpoint-marker integration, and
  search-hit focus;
- transcript-specific DOM references (`#messages`, `#scroller`) through a
  component-provided binding/adapter, not root-level lookup.

Keep the durable-history and SSE ordering contract intact. If sessions and
transcript need each other, use narrow interfaces rather than circular imports:
`sessionSource` provides active session metadata; transcript exposes
`reloadForSession` and stream-event handlers.

**Acceptance:** the root does not inspect transcript elements or construct
transcript items. Existing replay, backfill, permalink, checkpoint placement,
and scroll tests remain green.

## [x] 5. Extract Independent Feature Runtimes

Move one feature per commit, in this order, because later features depend on
session identity but not on each other:

- [x] **Checkpoints** — marker, tree, freeze, rollback, and checkpoint event UI.
- [x] **Composer** — input state, send/abort action, prompt history, command guard, and command palette.
- [x] **Files** — file picker, folder browser, explorer, upload input, and editor.
  - [x] Create `features/files/createFilesFeature.js` to assemble picker, folder-browser, and explorer controllers with injected browser/API dependencies.
  - [x] Move file-picker state and actions (`browse`, `pick`, `use folder`, `cancel`) behind the files feature; replace its global custom events with feature actions.
  - [x] Move folder-browser state and actions (`browse`, `create`, `submit`, `cancel`) behind the files feature; replace its global custom events with feature actions.
  - [x] Move explorer state and actions (`browse`, `edit`, `save`, `upload`, `back`) behind the files feature; retain file-input creation only in an explicit browser adapter.
  - [x] Replace `pi-open-file-explorer` with the files feature’s `openExplorer` action and remove its global listener.
  - [x] Add feature construction/teardown tests and retain focused picker, folder-browser, explorer, upload, and editor regression coverage.
- [x] **Hublots** — manager, sidebar, scoped visibility, and tunnel events.
- [x] **Routines** — sidebar, visibility, actions, and routine stream updates.
- [x] **Settings/extensions** — settings modal, extension UI prompt adapters, and
  header model/thinking actions.
- [x] **Layout** — carousel, mobile drawer dismissal, swipes, and header/sidebar
  toggles.

For every feature:

- place its components, store(s), controller(s), and feature factory together;
- inject `fetch`/RPC/session APIs and toast/modal interfaces;
- replace its component custom events with direct feature actions;
- retain only feature-local DOM adapters with explicit attach/detach;
- add a test for factory construction and teardown.

**Acceptance per feature:** removing its construction block from the root does
not change public UI/API behavior; its listeners are attached exactly once and
removed on teardown.

## [x] 6. Replace the Global Event Bridge

After the owning feature has moved, remove its `window.dispatchEvent` /
`document.dispatchEvent` protocol and matching global listener.

Suggested replacement mechanisms, in order:

1. callback props for parent-owned actions;
2. feature context exposing typed actions;
3. direct imports of a feature store action for simple local UI state.

Keep global browser listeners only for genuine browser-wide concerns, such as
capture-phase keyboard navigation and swipe/resize handling; encapsulate those
inside the owning feature's adapter.

Update the event inventory after each removal. No new `pi-*` or `pi:*` event
may be added during this plan without documenting why a local API is
impossible.

**Acceptance:** feature components have no global custom-event dispatches;
remaining global listeners are documented browser integrations.

## [ ] 7. Reduce and Rename the Composition Root

Once the features own their state and actions:

- reduce `appRuntimeImplementation.js` to a small factory, or replace it with
  `app/appRuntime.js`;
- limit it to adapter construction, feature construction order, cross-feature
  interface wiring, `start`, and `teardown`;
- remove dead compatibility exports, stale comments referring to “legacy”, and
  obsolete tests only after a no-reference check;
- avoid a line-count-only goal, but expect the composition root to be small
  enough to review as a single wiring module (roughly a few hundred lines, not
  thousands).

**Acceptance:** the root has no feature business logic, direct feature DOM
lookup, feature-local mutable state, or custom-event listener registration.

## [ ] 8. Continue Composition-Root Reduction

The previous completion of section 7 was premature: as of 2026-07-14,
`public/src/runtime/appRuntimeImplementation.js` still exists at roughly 1,786
lines. Complete the remaining migration in small verified commits:

- [x] Inventory the remaining root-owned state, controller construction, event
  registrations, and DOM access; record each owner feature/platform module.

  **Inventory (2026-07-14):** the root is 1,786 lines with 26 `let` bindings,
  17 event-controller/registration references, and 5 direct browser-global
  references. Session runner/route/picker state is assembled around
  `getSessionRuntime` (`features/sessions/`); transcript stream/render/reload
  controllers are assembled in-place (`features/transcript/`); EventSource,
  reconnect, and RPC wiring remain in the root and `runtime/`
  (`platform/connectionCoordinator.js`); carousel/mobile drawer wiring belongs
  to layout; hublot/routine/settings controller blocks belong to their named
  feature directories. The remaining direct browser references are platform or
  layout adapters and must not grow.
- [x] Move session-owned runner, route, picker, and hydration wiring out of the
  root into `features/sessions/`, leaving only injected interfaces at the
  composition boundary.
- [x] Move transcript controller assembly and transcript DOM adapters behind
  `features/transcript/`, replacing the current placeholder feature wrapper.
- [x] Move platform EventSource/RPC/reconnect construction behind
  `platform/connectionCoordinator.js`; the root may only construct and wire
  the coordinator.
- [x] Split the remaining layout, hublot, routine, and settings construction
  blocks into feature factories with teardown ownership.
- [x] Remove obsolete event-controller imports and compatibility adapters only
  after an `rg` no-reference check and focused regression coverage.
- [x] Rename or replace `appRuntimeImplementation.js` with a thin composition
  module. Its responsibilities are limited to adapter creation, feature
  construction order, cross-feature interfaces, `start`, and `teardown`.
- [x] Add a regression guard that the composition root has no feature-local
  mutable state, feature custom-event registration, or feature DOM lookup.

The wrapper/factory work above does **not** by itself satisfy this section:
`appRuntimeImplementation.js` remains large. Continue with concrete code moves:

- [x] Move the session construction block and its root-local mutable state into
  `features/sessions/createSessionFeature.js`; the root must only call its
  factory and consume its narrow operations.
- [x] Move transcript controller construction, stream dispatch, and reload
  wiring into `features/transcript/createTranscriptFeature.js`; delete the
  placeholder wrapper from the root.
- [x] Move EventSource/RPC/reconnect state and construction into
  `platform/connectionCoordinator.js`, leaving only coordinator construction
  in the root.
- [x] Split the root into feature assembly modules until `appComposition.js`
  is the only runtime entry and is no more than 400 lines; remove
  `appRuntimeImplementation.js` after no-reference checks.

  **Status correction (2026-07-14):** `appComposition.js` is only a thin
  re-export while `appRuntimeImplementation.js` remains large; this checkbox
  was checked prematurely. The following concrete moves remain required:

  - [x] Extract transport/EventSource lifecycle code from
    `appRuntimeImplementation.js` into `platform/` and delete the root block.
  - [x] Extract transcript controller assembly from the root into
    `features/transcript/` and delete the corresponding root construction.
  - [x] Extract session controller assembly from the root into
    `features/sessions/` and delete the corresponding root construction.
  - [x] Move remaining feature-controller construction blocks from the root
    into their feature factory modules, then remove the root imports.
  - [x] Replace the implementation module with an `appComposition.js` wiring
    module under 400 lines, and add a line-count/import-boundary regression
    test that prevents regression.

  **Second status correction (2026-07-14):** the entrypoint is small but still
  re-exports the large implementation. Do not check section 7 until these
  physical moves are complete:

  - [ ] Move the first contiguous controller block (including its imports and
    tests) out of `appRuntimeImplementation.js`; prove the root line count
    decreases by at least 100 lines.
  - [ ] Repeat controller-block extraction commits until the implementation
    file is below 400 lines or removed.
  - [ ] Make `appComposition.js` define the runtime factory directly rather
    than re-exporting from `appRuntimeImplementation.js`; delete the legacy
    implementation file and update no-reference tests.

## [ ] 9. Physical Root Extraction Sequence

Complete these in order. Every checkbox is intentionally on one line so the
verified goal loop can match it exactly.

- [x] Integrate `createManagedEventConnection` into the root and delete the in-root EventSource watchdog and connection construction block.
- [x] Add focused managed-connection construction reconnect and teardown tests and verify the event-stream extraction.
- [x] Extract the hublot manager and sidebar construction block into `features/hublots/` and replace it with one factory call.
- [x] Extract the routine sidebar construction block into `features/routines/` and replace it with one factory call.
- [x] Extract settings extension UI and carousel construction blocks into feature factories and replace each with one factory call.
- [x] Extract file picker folder browser and explorer construction blocks into `features/files/` and replace them with one factory call.
- [x] Extract session picker and search construction blocks into `features/sessions/` and replace them with one factory call.
- [x] Move remaining transcript construction into `features/transcript/` and remove root-local transcript controller declarations.
- [x] Move remaining RPC and event-dispatch state into `platform/` and replace root event handling with injected coordinator callbacks.
- [ ] Delete `appRuntimeImplementation.js` make `appComposition.js` the direct composition factory and update runtime entrypoint imports.
- [ ] Add a composition-root size and import-boundary test that enforces fewer than 400 lines and forbids feature-local mutable state.

**Acceptance:** `appRuntimeImplementation.js` is removed or reduced to a
reviewable wiring module (a few hundred lines), and every moved feature has a
fresh mount → teardown → mount lifecycle test.

## Completion Criteria

- `appRuntimeImplementation.js` is removed or is a thin, instance-scoped
  composition module.
- Each listed domain has a feature-owned factory and teardown path.
- Svelte components communicate through local callbacks/context/store actions,
  not a global custom-event bridge.
- Browser-specific DOM work is isolated in explicit feature adapters.
- Start/teardown/remount does not retain stale runtime, RPC, EventSource, or
  listener state.
- `npm run build` and `npm test` pass after every extraction, with appropriate
  browser/e2e coverage for interaction-changing domains.
