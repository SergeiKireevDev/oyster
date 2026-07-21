# Split `appCompositionRoot.js` into Reviewable Runtime Modules

## Goal

Reduce `public/src/runtime/appCompositionRoot.js` from a large imperative
runtime into a reviewable composition module without changing UI behavior.
Move feature state, controller construction, browser adapters, and lifecycle
ownership into explicit feature/platform assemblies. Do not treat renaming or
wrapping the existing root as extraction.

## Working Rules

- Implement one unchecked checkbox per verified commit.
- Preserve behavior before deleting compatibility code.
- Add focused construction and teardown tests for every extracted assembly.
- Keep browser APIs behind explicit injected adapters.
- Run `npm run build` and `npm test` after every extraction.
- Perform an `rg` no-reference check before removing imports or modules.

## [x] 1. Inventory Current Root Ownership

- [x] Record all imports, mutable bindings, DOM lookups, controller constructors, action registrations, and teardown registrations in `appCompositionRoot.js`.
- [x] Map every root block to one owner: platform, sessions, transcript, checkpoints, composer, files, hublots, routines, settings/layout, dialogs, or lifecycle.
- [x] Add an inventory regression test that reports new root-owned DOM access, mutable state, and controller construction.

**Acceptance:** every remaining block has a documented owner and new root
coupling cannot grow unnoticed.

## [x] 2. Extract Transcript Assembly

- [x] Create `features/transcript/createTranscriptAssembly.js` and move transcript DOM adapter, action, tool-card, assistant-stream, and renderer construction into it.
- [x] Move canonical reload, replay reconciliation, transcript sync, post-agent sync, and post-send sync construction into the transcript assembly.
- [x] Expose only narrow transcript operations required elsewhere, including reload, render, clear, stream dispatch, composer readiness, permalink actions, and teardown.
- [x] Add fresh mount → teardown → mount tests covering renderer, stream, sync timer, and DOM-adapter ownership.

**Acceptance:** the composition root does not construct transcript controllers,
inspect transcript elements, or own transcript-local mutable state.

## [x] 3. Extract Session Assembly

- [x] Create `features/sessions/createSessionAssembly.js` and move route parsing, runner state, session UI state, preview, open/switch, and refresh construction into it.
- [x] Move session boot and session picker integration behind the session assembly boundary.
- [x] Expose only boot, current runner/session accessors, runner lists, refresh, open/switch operations, and narrow event callbacks.
- [x] Add remount tests for runner state, picker cancellation, route synchronization, and session switching.

**Acceptance:** the root owns no runner, route, picker, preview, or session
hydration state.

## [x] 4. Extract Composer and Command Assembly

- [x] Create `features/composer/createComposerAssembly.js` and move composer history, prompt sending, abort, local echo coordination, and post-send behavior into it.
- [x] Move command guard, command palette, menu, input, keyboard, and action registration construction into the composer assembly.
- [x] Inject session, transcript, platform, modal, and toast interfaces instead of reading root state.
- [x] Add lifecycle tests for send/abort, command routing, prompt history, listener attachment, and teardown.

**Acceptance:** the root does not construct composer or command controllers and
does not own composer-local mutable state.

## [x] 5. Extract Checkpoint Assembly

- [x] Create `features/checkpoints/createCheckpointAssembly.js` and move checkpoint model picker, marker, tree, freeze, rollback, and action construction into it.
- [x] Inject session identity, transcript element access, fetch, modal, and toast interfaces.
- [x] Expose marker placement/refresh, tree load/refresh, checkpoint actions, and teardown.
- [x] Add fresh mount → teardown → mount tests for marker, tree, and action registration ownership.

**Acceptance:** the root only consumes the checkpoint assembly’s narrow public
operations.

## [ ] 6. Extract Dialog and Modal Adapters

- [x] Create `platform/createDialogAdapters.js` for modal shell, confirm, text, editor, option-picker, and extension UI adapters.
- [x] Move dialog resolver state and response handling behind instance-scoped adapter factories.
- [x] Ensure teardown cancels pending prompts and clears configured actions.
- [ ] Add cancellation and remount tests for every asynchronous dialog adapter.

**Acceptance:** the root creates one dialog adapter and contains no dialog
business logic or resolver state.

## [ ] 7. Extract Resource Assembly

- [ ] Create `features/resources/createResourceAssembly.js` to compose files, hublots, and routines with injected session and platform interfaces.
- [ ] Move shared scope and cross-refresh coordination behind the resource assembly.
- [ ] Expose only load/show/action operations required by layout, debug hooks, and session state application.
- [ ] Add tests for scope changes, cross-refresh ordering, listener uniqueness, and remount teardown.

**Acceptance:** the root contains one resource assembly call and no resource
controller construction or shared resource state.

## [ ] 8. Extract Settings and Layout Assembly

- [ ] Move remaining settings, extension UI, header, carousel, swipe, drawer, and responsive listener wiring into dedicated settings/layout assemblies.
- [ ] Replace direct root DOM lookups with an explicit component-provided or browser adapter interface.
- [ ] Expose settings operations, layout apply/reset operations, and teardown only.
- [ ] Add remount tests proving listeners attach once and detach completely.

**Acceptance:** the root does not inspect feature layout elements or register
feature-local browser listeners.

## [ ] 9. Extract Platform and Lifecycle Assembly

- [ ] Create `platform/createPlatformAssembly.js` to compose authenticated fetch, RPC transport, event dispatch, connection coordination, watchdog, and debug hooks.
- [ ] Create `runtime/createLifecycleAssembly.js` to own boot ordering, attachment ordering, delayed tasks, teardown ordering, and restart behavior.
- [ ] Remove stale root compatibility callbacks and inject narrow feature event maps into the platform assembly.
- [ ] Add connect → disconnect → connect and start → teardown → start tests covering RPC, EventSource, watchdog, delayed tasks, and debug hooks.

**Acceptance:** platform and lifecycle state are instance-scoped and the root
only wires their public interfaces.

## [ ] 10. Reduce the Final Composition Root

- [ ] Rewrite `appCompositionRoot.js` to contain only adapter creation, assembly construction order, cross-feature interface wiring, and lifecycle return values.
- [ ] Remove obsolete imports, compatibility exports, stale migration comments, and dead tests after no-reference checks.
- [ ] Add an import-boundary regression test that forbids feature controller constructors, feature-local mutable state, custom-event registration, and direct feature DOM access in the composition root.
- [ ] Run the full build, unit tests, Docker validation, and browser/e2e suite.

## Completion Criteria

- `appCompositionRoot.js` is a reviewable wiring module focused on adapter
  creation, assembly construction order, cross-feature interfaces, `start`,
  and `teardown`.
- No direct feature business logic remains in the root.
- DOM lookups are isolated to explicit adapters or component bindings.
- Each extracted assembly owns a complete teardown path and supports a fresh
  mount after teardown.
- Start → teardown → start tests pass without stale runtime, RPC, EventSource,
  timer, listener, resolver, or store state.
- `npm run build` and `npm test` pass, along with relevant Docker and browser/e2e
  validation.
