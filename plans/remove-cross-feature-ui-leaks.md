# Remove Cross-Feature UI Leaks

## Goal

Eliminate module-global feature action bridges and component-owned feature
workflows identified in `plans/ui-responsibility-audit.md`. Components should
render feature state and invoke mount-scoped services; assemblies should own
feature behavior, network calls, and teardown.

## Guardrails

- Use the existing mount-scoped `uiActionRegistry`, supplied by `App.svelte`,
  for component-to-feature operations. Add names to `uiActionNames.js`; do not
  add another module-global action registry.
- A feature assembly registers its own action handlers and returns unregister
  functions as part of teardown. Components may not import a `*Actions.js`
  module that stores mutable callbacks.
- Keep direct RPC/fetch, store mutation following a network action, toast
  policy, and cross-resource refresh inside the owning feature assembly.
- Preserve browser-visible IDs, action labels, modal content names, session
  behavior, and extension UI contracts.
- Complete exactly one unchecked item per verified commit. For every item run:

```sh
npm run build
npm test
docker build -t pi-lot-ui .
cd tests/e2e && npm test
```

## 1. Remove Obsolete Dialog Compatibility State

- [x] Delete unused `public/src/stores/dialogs.js` and
  `public/src/stores/optionPicker.js`, then add a no-reference test proving
  `dialogService` is the only dialog/option-picker state path.

**Acceptance:** no obsolete global dialog or option-picker store remains.

## 2. Convert Resource UI Actions to Scoped Registry Actions

- [x] Add names for file-picker, folder-browser, file-explorer, hublot, and
  routine UI actions to `runtime/uiActionNames.js`. Add registry tests covering
  namespaced registration, replacement, and unregistration.
- [x] Make `createResourceAssembly()` accept the scoped UI action registry and
  register its existing file-picker handlers. Return their unregister functions
  from resource teardown without changing any component yet.
- [x] Change `FilePickerModal.svelte` to invoke the scoped file-picker actions,
  then delete `features/files/filePickerActions.js` and its configuration call.
  Test browse, choose, use-folder, and cancel routing.
- [x] Register folder-browser handlers through `createResourceAssembly()` and
  change `FolderBrowserModal.svelte` to invoke them. Delete
  `features/files/folderBrowserActions.js` and its configuration call; test
  browse, create, submit, and cancel routing.
- [x] Register file-explorer handlers through `createResourceAssembly()` and
  change `FileExplorerModal.svelte` to invoke them. Delete
  `features/files/fileExplorerActions.js` and its configuration call; test
  browse, edit, save, upload, back, and return-to-hublot routing.
- [x] Register the built-in file-explorer opener through
  `createResourceAssembly()` and change `HublotList.svelte` and
  `HublotManagerModal.svelte` to invoke it. Delete
  `features/files/filesActions.js` and its configuration call; test both entry
  points open the current-workdir explorer.
- [x] Add `removeHublot(id)` to the hublot runtime's public operations. It must
  perform the network request, update the relevant hublot store, and report
  failures through the injected toast policy; add success and failure tests.
- [x] Register hublot show/create/toggle-scope/remove/command-palette actions
  through `createResourceAssembly()`. Change `HublotSidebar.svelte`,
  `HublotList.svelte`, and `HublotManagerModal.svelte` to invoke them; delete
  `features/hublots/hublotActions.js` and its configuration call.
- [x] Register routine-run actions through `createResourceAssembly()` and
  change `RoutineList.svelte` to invoke them. Delete
  `features/routines/routineActions.js` and its configuration call; test run
  requests remain session-scoped.

**Acceptance:** resource components contain no direct resource fetch/store/toast
workflow and import no mutable `*Actions.js` bridge.

## 3. Convert Composer and Checkpoint UI Actions

- [x] Add scoped action names for composer input, keydown, send, abort, and
  checkpoint-tree open/rollback. Register the composer actions from
  `createComposerAssembly()` with teardown-safe unregister functions.
- [x] Change `Composer.svelte` to invoke scoped composer actions, then delete
  `features/composer/composerActions.js` and its configuration call. Test text
  input, Enter, send, and abort routing after remount.
- [x] Register checkpoint-tree open and rollback operations from
  `createCheckpointAssembly()` with teardown-safe unregister functions.
- [x] Change `CheckpointTreeNode.svelte` to invoke scoped checkpoint actions,
  then delete `features/checkpoints/checkpointTreeActions.js` and its
  configuration call. Test open-session and rollback routing.

**Acceptance:** composer and checkpoint-tree components do not rely on
module-global feature callback state.

## 4. Convert Session and Settings UI Actions

- [x] Add scoped action names for every session-picker operation and register
  them from the session-picker runtime with teardown-safe unregister functions.
- [x] Change `SessionPickerModal.svelte` to invoke scoped session-picker
  actions, then delete `features/sessions/sessionPickerActions.js` and its
  configuration call. Preserve search debounce, folder loading, choose, stop,
  delete, and cancellation tests.
- [x] Extract session-family grouping and active/inactive partitioning from
  `SessionPickerModal.svelte` into a pure session-picker view-model helper.
  Move only pure transforms; leave DOM focus and debounce lifecycle in the
  component. Add focused transform tests.
- [x] Add scoped names for header and settings-change actions, and register
  them from the settings/layout runtime with teardown-safe unregister functions.
- [x] Change `Header.svelte` and `SettingsModal.svelte` to invoke scoped
  actions, then delete `features/settings/headerActions.js`,
  `features/settings/settingsActions.js`, and their configuration calls.
- [ ] Move SettingsModal's `localStorage` read/write behind an injected settings
  preference service. Test the persisted thinking-visibility value and runtime
  refresh behavior.

**Acceptance:** session and settings components contain no module-global action
bridge or direct persistence policy.

## 5. Scope Checkpoint Picker and Auth Browser Effects

- [ ] Add `createCheckpointModelPickerService()` with instance-scoped picker
  state, pending resolver, model preference adapter, and modal-shell interface.
  Add independent-instance and replacement-settlement tests.
- [ ] Provide the checkpoint picker service from `App.svelte` and pass it into
  the checkpoint assembly/runtime. Do not migrate the modal component in this
  step; prove fresh mount services are distinct.
- [ ] Change `CheckpointModelPickerModal.svelte` and checkpoint feature calls
  to use the scoped picker service. Preserve model selection, cancellation,
  extension UI, and modal-title contracts.
- [ ] Delete `stores/checkpointModelPicker.js` after a no-reference check and
  add a teardown test that settles an open picker promise.
- [ ] Add an auth browser service with token persistence and reload operations,
  provide it through context, and change `AuthGate.svelte` to use it. Test that
  token save/reload behavior is preserved without direct browser globals in the
  component.

**Acceptance:** checkpoint picker resolvers and auth browser effects are scoped
services rather than global stores or component platform calls.

## 6. Finish Semantic and Boundary Cleanup

- [ ] Replace the clickable checkpoint-tree `div[role="button"]` controls with
  native buttons while preserving tree nesting, current-session styling,
  keyboard activation, and rollback target behavior.
- [ ] Replace clickable hublot preview/list `div[role="button"]` controls with
  native buttons or documented composite-widget controls. Preserve iframe
  overlay behavior and external-open keyboard activation.
- [ ] Add a static boundary test forbidding mutable module-global action bridges
  (`let actions`, `let action`, or `let dispatch`) in feature action modules,
  direct `removeHublot(fetch, ...)` in components, and direct browser globals
  in `AuthGate.svelte` or `SettingsModal.svelte`.
- [ ] Run the stale-reference checks and full validation matrix, then update
  this final checkbox only after all checks pass.

```sh
rg "configure[A-Za-z]+Actions|let actions = \{\}|let action;|let dispatch;" public/src/features public/src/components
rg "from .*features/.+Actions" public/src/components
rg "removeHublot\(fetch" public/src/components
rg "localStorage|location\.reload" public/src/components/AuthGate.svelte public/src/components/SettingsModal.svelte
```

## Completion Criteria

- No feature `*Actions.js` module is a mutable module-global callback bridge.
- Components delegate feature workflows through mount-scoped actions/services.
- Feature assemblies own network requests, associated store updates, toast
  policy, and cross-feature refresh work.
- Checkpoint picker and auth browser behavior are instance-scoped services.
- Remaining custom interactive surfaces use semantic native controls or a
  documented composite-widget role.
- Build, unit, Docker, and e2e validation pass.
