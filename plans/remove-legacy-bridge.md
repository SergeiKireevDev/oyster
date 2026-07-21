# Remove `legacyBridge.js`

## Goal

Replace component-to-legacy handler registries with direct imports of focused
action modules and Svelte stores. Keep transport, SSE lifecycle, and required
document-level timing in `legacy.js` until they have safe independent owners.

## Preconditions

- Preserve component DOM IDs/selectors and existing RPC response contracts.
- Keep file-backed transcript history authoritative and SSE best-effort.
- Extract one bridge domain per commit; do not combine behavior changes.
- Validate every step:

```sh
npm run build
npm test
docker build -t pi-lot-ui .
cd tests/e2e && npm test
```

## 1. Establish Direct Action Conventions

1.1. ✅ Action modules accept injected transport (`fetch`/`rpc`) and return
structured data or throw normalized errors.

1.2. ✅ UI/store modules own visible loading, error, and selection state.

1.3. ✅ Session actions receive narrow callback hooks for runner switching and
refresh behavior; action modules do not import `legacy.js`.

## 2. Remove File Browser Bridges

### File Explorer

Move browse/edit/save/upload/navigation/hidden-toggle handlers from the
`fileExplorerHandlers` registry into direct File Explorer component actions.

✅ Edit-content updates now write directly to the `fileExplorer` store; save
reads the store value, and its bridge export/handler has been removed.

- Retain `fileBrowserActions.js` for browse/read/save/upload/download transport.
- Move explorer navigation and editing state entirely to `fileExplorer` store.
- Replace modal return-to-hublots behavior with a store action/callback that
  does not mutate modal DOM.

### File Picker and Folder Browser

Move picker/folder selection, cancellation, hidden-file toggles, and folder
creation into store-backed action modules.

- Use shared browse actions where response shapes match.
- Keep composer insertion as an injected callback until composer sending is
  independently action-owned.
- Preserve extension file/folder-picker response contracts exactly.

**Acceptance:** remove `setFileExplorerHandlers`, `setFilePickerHandlers`, and
`setFolderBrowserHandlers` plus all exports using those registries.

## 3. Remove Hublot and Routine Bridges

### Hublot Manager

- Move open/create/scope-toggle and managed command-palette setup into a
  hublot manager action module.
- ✅ Hublot Manager description input now writes directly to its store; its
  bridge export and registration were removed.
- ✅ Hublot creation request transport is isolated in `hublotActions.js` with
  request-contract regression coverage.
- ✅ Scope transition and atomic hublot/routine refresh sequencing are isolated
  in `hublotActions.js` with regression coverage.
- Refresh manager and sidebar stores atomically after mutations, respecting
  current session scope.
- Keep File Explorer opening as a store/modal action, not a bridge callback.

### Routines

- Create a scoped routine refresh action that reads the active session and
  scope stores, fetches routines, filters them, and updates all routine stores
  atomically.
- Let `RoutineList.svelte` call lifecycle actions directly, then invoke that
  refresh action.

**Acceptance:** remove `setHublotHandlers`, `setHublotManagerHandlers`, and
`setRoutineHandlers`; preserve sidebar and manager e2e behavior.

## 4. Remove Session Picker Bridge

Create a session-picker action module for:

- query/scope/folder/tool-filter store updates;
- session search and folder loading;
- session selection, stopping, deletion, and search-hit navigation.

Inject session lifecycle callbacks from the session action boundary for runner
switches, previews, and transcript reload. Preserve deliberate
`connect({ replay: false })` switching behavior.

**Acceptance:** remove `setSessionPickerHandlers` and all session-picker bridge
exports; session/model/transcript e2e tests remain green.

## 5. Remove Checkpoint Tree Bridge

Create checkpoint-tree actions for opening a selected runner and rollback.

- Reuse checkpoint API actions for server requests.
- Inject model-selection and runner-switch callbacks.
- Keep checkpoint component busy/frozen state in existing stores.

**Acceptance:** remove `setCheckpointTreeHandlers`,
`openCheckpointTreeSession`, and `rollbackCheckpoint` bridge exports.

## 6. Remove Menu and Command Palette Bridges

Replace registry dispatch with a typed command/action catalog.

- Menu and command palette import the catalog directly.
- Catalog entries call focused action modules or narrow injected session
  lifecycle callbacks.
- Keep global keyboard/document listeners in `legacy.js` until moved safely.

**Acceptance:** remove `setMenuActionHandler`, `setCommandPaletteHandlers`,
and their dispatch exports.

## 7. Remove Settings Bridge

Move settings persistence and post-change reload/reconnect behavior into a
settings action module with an injected transport/session-refresh callback.

**Acceptance:** remove `setSettingsHandlers` and `reloadAfterSettingsChange`.

## 8. Delete the Bridge

After every registry has zero consumers:

1. Run `rg "legacyBridge" public/src tests`.
2. Remove `public/src/lib/legacyBridge.js`.
3. Remove its import and all registration calls from `legacy.js`.
4. Add/update tests guarding direct action behavior.
5. Run the full validation suite.

## Completion Criteria

- No `legacyBridge.js` imports or handler registrations remain.
- Svelte components use stores and focused action modules directly.
- `legacy.js` contains transport/session bootstrap and unavoidable global DOM
  timing only.
- Unit, Docker, and full e2e validation pass.
