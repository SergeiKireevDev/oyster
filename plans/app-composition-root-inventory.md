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
