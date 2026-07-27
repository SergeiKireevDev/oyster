# `appCompositionRoot.js` Ownership Inventory

Recorded 2026-07-14 from `public/src/runtime/appCompositionRoot.js` before the
assembly extraction plan begins. This is a factual inventory only; owner mapping
is tracked by the next checklist item.

## Baseline

- Lines: **1,477**
- Import declarations: **85**
- Root `let` bindings: **15**
- Direct DOM lookup/access sites: **18**
- Root controller/factory construction assignments: **44**
- Direct feature action registrations: **8**
- Explicit detach operations in `detachRuntimeEventAdapters`: **17**

## Imports

All imported module specifiers, in source order:

1. `svelte`
2. `svelte/store`
3. `./authClient.js`
4. `./transportRuntime.js`
5. `./eventStreamUtils.js`
6. `./transcriptRuntime.js`
7. `./eventStream.js`
8. `../platform/createManagedEventConnection.js`
9. `../platform/createPlatformEventDispatch.js`
10. `./debugHooks.js`
11. `./delayedTaskRegistry.js`
12. `./lifecycleLogger.js`
13. `./runtimeCleanup.js`
14. `./startController.js`
15. `./runtimeStarterDependencies.js`
16. `./runtimeDependencies.js`
17. `./sessionBootController.js`
18. `./sessionBootDependencies.js`
19. `./featureAssembly.js`
20. `../features/sessions/createSessionFeature.js`
21. `../features/sessions/createSessionPickerRuntime.js`
22. `../features/transcript/createTranscriptRuntime.js`
23. `./extensionUiAdapters.js`
24. `./runtimeEventAdapters.js`
25. `./runtimeAttachments.js`
26. `./sessionRuntime.js`
27. `./carouselController.js`
28. `./carouselEventDependencies.js`
29. `../stores/carousel.js`
30. `../stores/appSession.js`
31. `../stores/checkpointModelPicker.js`
32. `../stores/checkpointMarker.js`
33. `../stores/checkpointRestores.js`
34. `../stores/checkpointTree.js`
35. `../stores/commandPalette.js`
36. `../stores/fileExplorer.js`
37. `../stores/filePicker.js`
38. `../stores/folderBrowser.js`
39. `../stores/composer.js`
40. `../stores/header.js`
41. `../stores/hublotManager.js`
42. `../stores/hublots.js`
43. `../stores/dialogs.js`
44. `../stores/modal.js`
45. `../stores/optionPicker.js`
46. `../stores/routines.js`
47. `../stores/sessionPicker.js`
48. `../stores/toasts.js`
49. `../lib/messageUtils.js`
50. `../lib/markdownRenderer.js`
51. `../lib/transcriptUtils.js`
52. `../lib/transcriptBackfill.js`
53. `../lib/transcriptActions.js`
54. `../lib/checkpointActions.js`
55. `../features/checkpoints/checkpointFeature.js`
56. `../features/checkpoints/checkpointTreeActions.js`
57. `../lib/commandActions.js`
58. `../lib/commandController.js`
59. `../lib/promptActions.js`
60. `../lib/postSendTranscriptSyncController.js`
61. `../lib/textInsertion.js`
62. `../lib/composerHistoryController.js`
63. `../features/composer/composerActions.js`
64. `../lib/hublotActions.js`
65. `../lib/hublotController.js`
66. `../features/hublots/hublotActions.js`
67. `../features/hublots/createHublotFeature.js`
68. `../lib/hublotManagerController.js`
69. `../features/files/folderBrowserActions.js`
70. `../features/files/filesActions.js`
71. `../features/files/fileExplorerActions.js`
72. `../features/files/createFilesRuntime.js`
73. `../features/files/filePickerActions.js`
74. `../lib/routineActions.js`
75. `../lib/routineController.js`
76. `../features/routines/routineActions.js`
77. `../features/settings/createSettingsLayoutRuntime.js`
78. `../lib/settingsController.js`
79. `../features/settings/settingsActions.js`
80. `../features/settings/headerActions.js`
81. `../lib/storeSnapshot.js`
82. `../lib/fileBrowserActions.js`
83. `../lib/clipboardController.js`
84. `../lib/extensionUiController.js`
85. `../stores/transcriptItems.js`

## Root Mutable Bindings

| Line | Binding | Initial value / purpose |
|---:|---|---|
| 107 | `platformEvents` | deferred platform event runtime |
| 230 | `composerHistory` | deferred composer history controller |
| 325 | `transcriptRenderer` | deferred transcript renderer |
| 357 | `state` | active hydrated session state |
| 389 | `currentRunner` | active runner ID |
| 390 | `runnersNow` | current runner list |
| 393 | `afterTranscript` | one-shot post-render callback |
| 433 | `sessionOpenController` | deferred session open controller |
| 451 | `onRunnersUpdate` | picker runner-update hook |
| 460 | `connected` | current connection state |
| 486 | `transcriptGateRequired` | replay/render gate |
| 583 | `sessionFile` | local durable-history query state |
| 693 | `commandGuard` | resettable command guard |
| 762 | `cmdState` | command palette match/selection state |
| 835 | `commandPaletteInputController` | lazily attached input controller |
| 1097 | `tunnelScopeAll` | hublot/routine scope toggle |
| 1255 | `folders`, `currentFolder` | session-picker initial-load temporaries |

The baseline count of 15 refers to root-scoped `let` declarations; lines 583
and 1255 are function-local and are retained above because they are mutable
bindings discovered in the complete file scan.

## Direct DOM Access

| Line | Access |
|---:|---|
| 132 | Defines `$` via `document.getElementById` |
| 134 | Looks up `#gate` |
| 150 | Looks up `#messages` |
| 151 | Looks up `#scroller` |
| 187 | Queries assistant messages under `#messages` |
| 274 | Reads `#treebar.classList` |
| 637 | Looks up `#input` |
| 671 | Reads command-palette `classList` |
| 739 | Looks up `#cmdPalette` |
| 752 | Reads overlay `classList` |
| 872 | Reads command-palette `classList` |
| 996 | Looks up `#input` during text insertion |
| 1161 | Looks up `#hublots` |
| 1162 | Looks up `#treebar` |
| 1314 | Queries a transcript element by entry ID |
| 1339 | Looks up `#overlay` |
| 1369 | Looks up `#hublots` for layout assembly |
| 1370 | Looks up `#treebar` for layout assembly |

## Controller and Factory Construction

Root construction assignments, in source order:

- `lifecycleLog` → `createLifecycleLogger`
- `delayedTasks` → `createDelayedTaskRegistry`
- `transcriptScroll` → `createTranscriptScrollAdapter`
- `toolCards` → `createToolCardRegistry`
- `transcriptActions` → `createTranscriptActions`
- `assistantStream` → `createAssistantStream`
- `handleTranscriptStreamEvent` → `createTranscriptStreamEventHandler`
- `checkpointFeature` → `createCheckpointFeature`
- `applyState` → `createSessionStateApplier`
- `runnerState` → `createSessionRunnerState`
- `sessionFeature` → `createLazySessionFeature`
- `previewController` → `createSessionPreviewController`
- `sessionUi` → `createSessionUiRuntime`
- `managedConnection` → `createManagedEventConnection`
- `isDuplicateSseEvent` → `createLoggedSseDeduper`
- `afterTranscriptRender` → `createTranscriptAfterRenderController`
- `reloadTranscript` → `createCanonicalTranscriptController`
- `transcriptSyncScheduler` → `createTranscriptSyncScheduler`
- `postAgentTranscriptSyncController` → `createDebouncedTranscriptSyncController`
- `agentStart` → `createAgentStartController`
- `agentCompletion` → `createAgentCompletionController`
- `postSendTranscriptSyncController` → `createPostSendTranscriptSyncController`
- `refreshStateNow` → `createSessionStateRefresher`
- `extensionUiAdapters` → `createExtensionUiAdapters`
- `commandGuard` → `createCommandGuard`
- lazy command input controller → `createCommandPaletteInputController`
- `commandPaletteRunController` → `createCommandPaletteRunController`
- `commandPaletteKeyboardController` → `createCommandPaletteKeyboardController`
- `menuEventController` → `createMenuEventController`
- `filesRuntime` → `createFilesRuntime`
- `hublotManagerController` → `createHublotManagerController`
- `hublotController` → `createHublotFeature`
- `mobileDrawerDismissController` → `createMobileDrawerDismissController`
- `routineSidebarController` → `createRoutineSidebarController`
- `routineController` → `createRoutineController`
- `sessionPickerRuntime` → `createSessionPickerRuntime`
- `transcriptRuntime` → `createTranscriptRuntime`
- `settingsLayoutRuntime` → `createSettingsLayoutRuntime`
- `runtimeAttachments` → `createRuntimeAttachments`
- `boot` → `createSessionBootController`
- `runtimeTeardown` → `createRuntimeCleanup`
- `runtimeStarter` → `createRuntimeStarter`
- `featureAssembly` → `createFeatureAssembly`
- `runtimeEventAdapters` → `createRuntimeEventAdapters`

## Action Registrations

Direct action registrations in the root:

| Line | Registration | Detach handle |
|---:|---|---|
| 284 | `configureCheckpointTreeActions` | `detachCheckpointTreeActions` |
| 728 | `configureComposerActions` | `detachComposerActions` |
| 987 | `configureFilePickerActions` | `detachFilePickerActions` |
| 1045 | `configureFolderBrowserActions` | `detachFolderBrowserActions` |
| 1084 | `configureFileExplorerActions` | `detachFileExplorerActions` |
| 1147 | `configureHublotActions` | `detachHublotActions` |
| 1169 | `configureFilesActions` | `detachFilesActions` |
| 1213 | `configureRoutineActions` | `detachRoutineActions` |

Session-picker, settings, and header action registrations are constructed by
their existing feature runtime factories, while their detach handles are still
collected by the root.

## Teardown Registrations

`detachRuntimeEventAdapters` currently releases, in order:

1. carousel event registration
2. mobile drawer dismiss controller
3. header actions
4. settings actions
5. menu event controller
6. composer actions
7. command-palette keyboard controller
8. command-palette run controller
9. checkpoint-tree actions
10. file-picker actions
11. folder-browser actions
12. file-explorer actions
13. hublot actions
14. routine actions
15. session-picker actions
16. files actions
17. optional command-palette input controller

`createRuntimeCleanup` additionally owns these teardown callbacks:

- disconnect the platform connection coordinator
- clear the EventSource compatibility hook
- dispose the RPC client
- stop the reconnect watchdog
- run `detachRuntimeEventAdapters`
- detach authenticated-fetch/debug attachments
- cancel all delayed tasks
- transition connection state to lost

The final lifecycle return delegates teardown to this `runtimeTeardown`
controller.

## Owner Map

Every root block is assigned to exactly one extraction owner. Shared calls are
owned by the assembly that constructs them; cross-feature callbacks remain
narrow interfaces supplied by the final composition module.

| Root lines / block | Owner | Destination boundary |
|---|---|---|
| 107–118 lifecycle logger and delayed-task setup | lifecycle | `runtime/createLifecycleAssembly.js` |
| 119–145 token, transport, auth gate, URL route parsing, URL synchronization | platform | `platform/createPlatformAssembly.js` |
| 146–253 transcript DOM, scrolling, tool cards, transcript actions, assistant stream, local echoes, stream dispatch | transcript | `features/transcript/createTranscriptAssembly.js` |
| 254–315 checkpoint model picker, feature construction, marker/tree helpers, checkpoint action registration | checkpoints | `features/checkpoints/createCheckpointAssembly.js` |
| 316–354 transcript renderer, clear/render orchestration, tail-first backfill | transcript | `features/transcript/createTranscriptAssembly.js` |
| 355–382 hydrated state application and header/session store updates | sessions | `features/sessions/createSessionAssembly.js` |
| 383–457 runner state, lazy session runtime, session preview/open, session UI state | sessions | `features/sessions/createSessionAssembly.js` |
| 458–525 managed connection, replay gate bridge, platform event dispatch | platform | `platform/createPlatformAssembly.js` |
| 526–618 canonical reload, transcript sync, agent completion, post-send reconciliation | transcript | `features/transcript/createTranscriptAssembly.js` |
| 619–634 debounced session state refresh | sessions | `features/sessions/createSessionAssembly.js` |
| 635–734 composer input, prompt history, send/abort, command guard, composer action registration | composer | `features/composer/createComposerAssembly.js` |
| 735–877 command palette state, positioning, input/run/keyboard controllers | composer | `features/composer/createComposerAssembly.js` |
| 878–914 menu action routing and browser menu controller | composer | `features/composer/createComposerAssembly.js` |
| 915–1009 file-picker state/dependencies/actions | files | `features/resources/createResourceAssembly.js` |
| 1010–1051 folder-browser workflow/actions | files | `features/resources/createResourceAssembly.js` |
| 1052–1066 agent-message helper used by resource actions | hublots | `features/resources/createResourceAssembly.js` |
| 1067–1096 file-explorer workflow/actions | files | `features/resources/createResourceAssembly.js` |
| 1097–1144 hublot scope, manager, feature factory, scope refresh | hublots | `features/resources/createResourceAssembly.js` |
| 1145–1156 hublot action registration | hublots | `features/resources/createResourceAssembly.js` |
| 1157–1167 mobile drawer dismissal | settings/layout | `features/settings/createSettingsLayoutAssembly.js` |
| 1168–1172 files open action registration | files | `features/resources/createResourceAssembly.js` |
| 1173–1214 routine visibility, sidebar/controller construction, routine actions | routines | `features/resources/createResourceAssembly.js` |
| 1215–1290 session picker construction, initial data, search-hit callbacks | sessions | `features/sessions/createSessionAssembly.js` |
| 1291–1299 search-hit focus adapter | transcript | `features/transcript/createTranscriptAssembly.js` |
| 1300–1336 transcript permalink runtime, transcript element adapters, durable entry fetch | transcript | `features/transcript/createTranscriptAssembly.js` |
| 1337–1349 modal close/settings modal shell helpers | dialogs | `platform/createDialogAdapters.js` |
| 1350–1377 settings, extension UI, header, carousel/layout construction | settings/layout | `features/settings/createSettingsLayoutAssembly.js` |
| 1378–1393 authenticated-fetch and debug attachments | platform | `platform/createPlatformAssembly.js` |
| 1394–1477 session boot, aggregate detach order, runtime cleanup/start, feature assembly, event adapters, lifecycle return | lifecycle | `runtime/createLifecycleAssembly.js` |

### Mutable-State Owners

| Binding | Owner |
|---|---|
| `platformEvents`, `connected`, `transcriptGateRequired` | platform |
| `composerHistory`, `commandGuard`, `cmdState`, `commandPaletteInputController` | composer |
| `transcriptRenderer`, `afterTranscript` | transcript |
| `state`, `currentRunner`, `runnersNow`, `sessionOpenController`, `onRunnersUpdate` | sessions |
| `tunnelScopeAll` | hublots/resources |
| function-local `sessionFile` | transcript |
| function-local `folders`, `currentFolder` | sessions |

### DOM-Access Owners

- Transcript owns `#messages`, `#scroller`, transcript queries, and entry focus.
- Composer owns `#input`, `#cmdPalette`, and command-palette class checks.
- Checkpoints owns the tree-open query only through an injected layout adapter.
- Settings/layout owns `#hublots`, `#treebar`, drawer class checks, and responsive
  browser integration.
- Dialogs owns `#gate` and `#overlay` through explicit browser/store adapters.
- The final composition root must not perform these lookups directly.
