# Make the Svelte UI More Idiomatic

## Goal

Replace the remaining global UI event and controller bridges with scoped Svelte
interfaces, make overlay ownership local to each modal, and remove repetitive
non-semantic interactive controls. Preserve RPC, session, transcript, and
runtime lifecycle behavior.

## Guardrails

- Keep `appCompositionRoot.js` as the application composition root; do not
  create another global event hub.
- Keep transport, session, transcript, and browser lifecycle state outside
  Svelte components.
- Scope UI action and dialog services to one `App` mount. Teardown must clear
  registrations and settle pending prompts.
- Preserve browser-visible IDs, extension UI contracts, and modal content names
  unless a matching test changes with them.
- Complete exactly one unchecked item per verified commit. For every item run:

```sh
npm run build
npm test
docker build -t pi-lot-ui .
cd tests/e2e && npm test
```

## 1. Replace Global Component Event Dispatch

- [x] Add `createUiActionRegistry()` with `register(name, handler)`,
  `invoke(name, ...args)`, and idempotent `teardown()` operations. Add unit
  tests for replacement registration, missing actions, and teardown.
- [x] Have `App.svelte` create one UI action registry, provide it through
  Svelte context, and pass it to `startAppRuntime()`. Add a mount → unmount →
  mount test proving a disposed registry is not reused.
- [x] Register the existing menu-action implementation with the runtime's UI
  action registry under one named action. Do not change `Menu.svelte` in this
  step; test that invoking the registry reaches the existing implementation.
- [x] Change `Menu.svelte` to obtain the registry from context and invoke the
  named menu action. Delete the `pi-menu-action` `window` event dispatch and
  its event-listener adapter; test all menu action values still route.
- [x] Register the existing command-palette selection implementation with the
  runtime's UI action registry under one named action. Do not change
  `CommandPalette.svelte` in this step; test registry invocation reaches the
  existing implementation.
- [x] Change `CommandPalette.svelte` to invoke the scoped action registry for
  mouse selection. Delete the `pi-command-palette-run` `window` event dispatch
  and its event-listener adapter; test mouse and keyboard selection routing.
- [x] Run `rg "pi-menu-action|pi-command-palette-run|window\.dispatchEvent" public/src`
  and remove the two legacy custom-event paths. Document any intentional,
  component-local DOM `dispatchEvent` calls in the boundary test.

**Acceptance:** no component-to-runtime action uses a global custom `window`
event, and remounting cannot invoke a disposed runtime.

## 2. Make Dialog State and Operations Instance-Scoped

- [x] Add `createDialogService()` that owns text, editor, confirm, and
  option-picker presentation state, but does not yet replace existing dialog
  exports. Test independent service instances have independent state.
- [x] Add a dialog-service Svelte context provider in `App.svelte`, and pass
  the same service to `startAppRuntime()`. Test mount → teardown → mount creates
  fresh services.
- [x] Move text-prompt open, cancel, and submit promise handling from
  `stores/dialogs.js` into the dialog service. Update `TextPromptModal.svelte`
  and its footer to consume context; test replacement and teardown settlement.
- [x] Move editor-prompt open, cancel, and submit promise handling into the
  dialog service. Update `EditorPromptModal.svelte` and its footer to consume
  context; test replacement and teardown settlement.
- [x] Move confirm-prompt open and answer handling into the dialog service.
  Update `ConfirmPromptModal.svelte` and its footer to consume context; test
  false settlement on replacement and teardown.
- [x] Move option-picker open, cancel, and choose handling into the dialog
  service. Update `OptionPickerModal.svelte` and its footer to consume context;
  preserve searchable, keyboard, cancel, and selected-index behavior in tests.
- [x] Rewire `createDialogAdapters.js` to use the instance dialog service and
  remove `configureDialogController`, `configureOptionPickerController`, and
  their module-level controller variables after an `rg` no-reference check.

**Acceptance:** prompt state, resolvers, and operations belong to one mounted
application; no global dialog store contains runtime callbacks.

## 3. Give Each Modal Its Own Footer and Actions

- [x] Move checkpoint-model-picker footer controls from `Overlays.svelte` to
  `CheckpointModelPickerModal.svelte`, preserving cancel, submit, and model
  selection behavior with a focused test.
- [x] Move hublot-manager footer controls from `Overlays.svelte` to
  `HublotManagerModal.svelte`, preserving scope toggle and close behavior with
  a focused test.
- [x] Move folder-browser footer controls from `Overlays.svelte` to
  `FolderBrowserModal.svelte`, preserving create, hidden-files, cancel, and
  submit behavior with a focused test.
- [x] Move file-picker footer controls from `Overlays.svelte` to
  `FilePickerModal.svelte`, preserving folder selection, hidden-files toggle,
  and cancellation behavior with a focused test.
- [x] Move file-explorer footer controls from `Overlays.svelte` to
  `FileExplorerModal.svelte`, preserving save, download, upload, navigation,
  and close behavior with a focused test.
- [x] Move settings and session-picker footer controls from `Overlays.svelte`
  to `SettingsModal.svelte` and `SessionPickerModal.svelte`, preserving close
  and cancellation behavior with focused tests.
- [x] Reduce `Overlays.svelte` to overlay-shell state, modal selection, carousel
  dots, toasts, and modal component rendering. Add a static test that it imports
  no feature action module and contains no feature-specific footer branch.

**Acceptance:** each modal owns its visible controls and local interaction;
`Overlays.svelte` is a declarative modal host.

## 4. Improve Interactive Semantics and Platform Boundaries

- [x] Replace clickable `span[role="button"]` controls in prompt, picker,
  checkpoint, and hublot modal components with styled native `button` elements.
  Preserve labels, titles, disabled behavior, and keyboard behavior in a markup
  regression test.
- [x] Replace clickable `span[role="button"]` controls in file, folder,
  session, and overlay-shell components with styled native `button` elements.
  Extend the markup regression test to cover every modal/overlay component.
- [x] Add a browser-action adapter with an `openExternal(url)` operation and
  inject it into hublot components/features. Remove direct `window.open` calls
  from Svelte components and test the adapter invocation.
- [x] Add a file-download URL builder to the browser-action adapter and inject
  it into the file-explorer feature. Remove tokenized download URL construction
  from Svelte markup and test URL encoding and download filename behavior.
- [ ] Inventory every component `document`, `window`, and element listener.
  For each listener, either retain it with an `onMount` cleanup/Svelte directive
  and a lifecycle test, or move it behind a feature/platform adapter. Record the
  final approved listener list in a regression test.

**Acceptance:** interactive UI controls are semantic by default, and direct
browser effects and listeners have explicit, testable owners.

## 5. Prove the Final UI Boundary

- [ ] Add a static boundary test that forbids global menu/command custom-event
  dispatch, module-level dialog controllers, feature-action imports in
  `Overlays.svelte`, and clickable span role-buttons in modal/overlay components.
- [ ] Run stale-reference checks and the complete validation matrix, then update
  this plan's final checkbox only after all checks pass.

```sh
rg "pi-menu-action|pi-command-palette-run|configureDialogController|configureOptionPickerController" public/src tests
rg "window\.dispatchEvent" public/src
rg "<span[^>]*role=\"button\"" public/src/components
```

## Completion Criteria

- Component-to-runtime actions use scoped interfaces rather than `window`
  custom events.
- Dialog state, resolvers, and actions are instance-scoped and teardown-safe.
- `Overlays.svelte` is a declarative host, not a feature-action router.
- Modal controls use semantic native elements.
- Browser effects and component lifecycle listeners have explicit owners.
- Build, unit, Docker, and e2e validation pass.
