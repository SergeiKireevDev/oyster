# UI Responsibility and Cross-Feature Boundary Audit

Audited: `public/src/components/`, `public/src/stores/`, and
`public/src/features/` at `949d846` (2026-07-15).

Legend: **OK** = responsibility is local or an intentional dependency;
**Watch** = technically valid but should be simplified when its owner changes;
**Leak** = a UI module reaches across a feature/runtime boundary or relies on a
module-global callback bridge.

## Findings Summary

1. **Primary leak — feature action singleton bridges.** Eleven `*Actions.js`
   modules retain mutable module-global callbacks (`let actions`, `let action`,
   or `let dispatch`) configured by an assembly and consumed by components.
   They are teardown-aware, but are not instance-scoped and can route a UI event
   to whichever runtime configured them last. This is the same pattern removed
   from dialogs and global window events.
2. **Primary component leak — hublot removal.** `HublotList.svelte` and
   `HublotManagerModal.svelte` call `removeHublot(fetch, id)`, mutate hublot
   stores, and create toasts directly. That workflow belongs to the hublot
   feature/runtime.
3. **Remaining service candidates.** Checkpoint model picker still combines
   presentation state, promise resolvers, `localStorage`, and modal shell calls
   in a global store. `modal.js` is also a global singleton rather than an
   app-mount service.
4. **Semantic interaction debt remains.** The completed span-button sweep did
   not cover clickable `div[role=button]` controls in checkpoint and hublot
   views. Native buttons should replace them unless the element has a true
   composite-widget role.

## Components

| Component(s) | Status | Responsibility assessment |
|---|---|---|
| `App.svelte` | **OK** | Correctly creates mount-scoped UI-action and dialog services and owns runtime mount/teardown. It is the appropriate provider boundary. |
| `AuthGate.svelte` | **Leak** | Writes the auth token to `localStorage` and calls `location.reload()` directly. It should invoke an auth/browser service supplied by context. |
| `BrowserDirectoryList.svelte` | **OK** | Presentational directory list with callback props; the file-browser helper is a pure view helper. |
| `CarouselDots.svelte` | **OK** | Renders carousel store state only. |
| `ChatLayout.svelte`, `Sidebars.svelte` | **OK** | Structural composition only. |
| `CheckpointModelPickerModal.svelte` | **Watch** | Feature-local rendering is appropriate, but its backing store is a global modal/promise service (see stores). |
| `CheckpointTreebar.svelte` | **OK** | Renders checkpoint feature state and delegates tree rows. |
| `CheckpointTreeNode.svelte` | **Leak** | Imports global checkpoint-tree action functions. It should receive callbacks or consume a scoped checkpoint action service. Its clickable `div[role=button]` elements are also semantic debt. |
| `CommandPalette.svelte`, `Menu.svelte` | **OK** | Correctly use the scoped UI-action registry; no global custom-event bridge remains. |
| `Composer.svelte` | **Leak** | Uses global composer action callbacks. Reading header/app-session presentation state is tolerable, but command invocation needs a scoped composer service or callback props. |
| `ConfirmPromptModal.svelte`, `EditorPromptModal.svelte`, `OptionPickerModal.svelte`, `TextPromptModal.svelte` | **OK** | Use the instance-scoped dialog service and keep focus/keyboard handling local. |
| `FileExplorerModal.svelte`, `FilePickerModal.svelte`, `FolderBrowserModal.svelte` | **Leak** | Render feature state correctly, but invoke module-global file action bridges. They should consume an instance resource/file service. |
| `Header.svelte` | **Leak** | Delegates header actions through a module-global settings action callback. Use a scoped settings/layout service. |
| `HublotList.svelte` | **Leak** | Directly performs hublot deletion via `fetch`, updates another feature's store, emits toasts, and invokes a global file action. It should only render data and invoke scoped resource actions. Its interactive preview controls are non-native div buttons. |
| `HublotManagerModal.svelte` | **Leak** | Directly performs hublot deletion, store mutation, and toast reporting; also crosses into files through a global action bridge. Retain only form/view logic and delegate workflows to scoped resource actions. Its preview hit target is a non-native div button. |
| `HublotSidebar.svelte` | **Leak** | Uses a module-global hublot action for display; delegate through a scoped resource service. |
| `Overlays.svelte` | **OK** | Now behaves as a declarative modal host and imports only modal state plus modal components. |
| `RoutineList.svelte` | **Leak** | Uses the module-global routine action bridge. |
| `SessionPickerModal.svelte` | **Leak / Watch** | Uses the module-global session-picker dispatcher. Its session-family partitioning and debounce are view-model logic; keep locally only if extracted into a pure helper with tests, otherwise move them to a session-picker view model. |
| `SettingsModal.svelte` | **Leak** | Persists a setting through `localStorage` and invokes a module-global settings bridge. Use a scoped settings service. |
| `ToastItem.svelte`, `Toasts.svelte` | **OK** | Toast display and timeout lifecycle are presentation-local. |
| `Transcript.svelte` | **OK** | Owns a component-local load listener with cleanup and renders transcript stores. |
| `AssistantMessage.svelte`, `UserMessage.svelte` | **Watch** | Rendering is local. Direct reads of checkpoint marker/restore stores couple transcript presentation to checkpoint UI state; pass a compact checkpoint view model or keep this documented as a deliberate display dependency. |
| `CheckpointButton.svelte`, `CheckpointRestoreButton.svelte`, `PermalinkButton.svelte`, `ToolCard.svelte` | **OK** | Leaf presentation components with callback props or pure formatting helpers. |

## Stores

| Store(s) | Status | Responsibility assessment |
|---|---|---|
| `appSession.js`, `carousel.js`, `checkpointMarker.js`, `checkpointRestores.js`, `checkpointTree.js`, `commandPalette.js`, `fileExplorer.js`, `filePicker.js`, `folderBrowser.js`, `header.js`, `hublotManager.js`, `hublots.js`, `routines.js`, `sessionPicker.js`, `toasts.js`, `transcriptItems.js`, `ui.js` | **OK** | Presentation state plus simple update operations only. Keep network, resolver, and lifecycle logic out of them. |
| `composer.js` | **Watch** | Its derived UI state depends on `appSession`. This is a reasonable presentation selector, but it is a cross-store dependency; move it to a composer view-model factory if composer state becomes mount-scoped. |
| `modal.js` | **Watch** | A simple modal shell store, but module-global. Convert to a mount-scoped modal service when the next app-remount/SSR boundary is needed. |
| `checkpointModelPicker.js` | **Leak** | Owns promise resolver state, modal shell side effects, local-storage persistence, and feature state. Replace it with an instance-scoped checkpoint picker service/feature operation, analogous to `dialogService`. |
| `dialogs.js`, `optionPicker.js` | **Leak / dead code** | The reference check found no imports of either module in `public/src` or tests. Delete both modules rather than retaining a second, obsolete dialog-state path. |

## Features

| Feature module(s) | Status | Responsibility assessment |
|---|---|---|
| `features/checkpoints/checkpointFeature.js`, `createCheckpointAssembly.js` | **OK** | Correct feature assembly/controller construction. |
| `features/checkpoints/checkpointTreeActions.js` | **Leak** | Module-global action callback bridge consumed by `CheckpointTreeNode.svelte`. |
| `features/composer/createComposerAssembly.js` | **Watch** | Owns composer and command construction appropriately, but should expose a scoped action interface rather than configure `composerActions.js`. |
| `features/composer/composerActions.js` | **Leak** | Module-global action callback bridge consumed by `Composer.svelte`. |
| `features/files/createFilesFeature.js`, `createFilesRuntime.js` | **OK** | Files feature construction is localized. |
| `features/files/fileExplorerActions.js`, `filePickerActions.js`, `folderBrowserActions.js`, `filesActions.js` | **Leak** | Four module-global callback bridges consumed by file and hublot components. Replace with a scoped file/resource action service. |
| `features/hublots/createHublotFeature.js`, `createHublotRuntime.js` | **Watch** | Hublot runtime construction is appropriate, but deletion must be added to its public operation surface so components stop calling `lib/hublotActions.js` directly. |
| `features/hublots/hublotActions.js` | **Leak** | Module-global callback bridge consumed by hublot components. |
| `features/layout/createLayoutFeature.js` | **OK** | Pure layout feature boundary. |
| `features/resources/createResourceAssembly.js` | **Leak / Watch** | Correctly coordinates files, hublots, and routines, but imports and configures all of their module-global action bridges. It should instead create and provide one instance-scoped resource action service. |
| `features/routines/createRoutineFeature.js`, `createRoutineRuntime.js` | **OK** | Routine construction is feature-local. |
| `features/routines/routineActions.js` | **Leak** | Module-global callback bridge consumed by `RoutineList.svelte`. |
| `features/sessions/createSessionAssembly.js`, `createSessionFeature.js`, `createSessionPickerRuntime.js` | **OK / Watch** | Session construction, boot, and picker runtime are correctly localized. Consider a pure session-picker view-model helper for presentation grouping/debouncing now held in the component. |
| `features/sessions/sessionPickerActions.js` | **Leak** | Module-global dispatcher consumed by `SessionPickerModal.svelte`. |
| `features/settings/createSettingsFeature.js` | **OK** | Feature-local construction. |
| `features/settings/createSettingsLayoutRuntime.js` | **Watch** | Combines settings, extension UI, header, carousel, and layout. It is an intentional integration boundary, but should split into settings and layout services if either grows further. |
| `features/settings/headerActions.js`, `settingsActions.js` | **Leak** | Module-global callbacks consumed by `Header.svelte` and `SettingsModal.svelte`. |
| `features/transcript/createTranscriptAssembly.js`, `createTranscriptFeature.js`, `createTranscriptRuntime.js` | **OK** | Transcript streaming, rendering, and feature construction are correctly separated from components. |

## Recommended Remediation Order

1. Replace all feature `*Actions.js` mutable globals with mount-scoped context
   services, beginning with the resource/files/hublots/routines group. This
   removes the largest remaining cross-feature leak and allows hublot deletion
   to move out of components.
2. Move checkpoint model picker into an instance-scoped checkpoint service and
   decide whether the modal shell should become mount-scoped at the same time.
3. Replace composer, checkpoint-tree, session-picker, and settings action
   bridges with scoped feature services; extract pure session-picker view-model
   helpers if the component remains large.
4. Move AuthGate token persistence/reload and Settings local-storage writes
   behind auth/settings browser services.
5. Replace remaining interactive div role-buttons with native buttons or a
   documented composite-widget implementation.
6. Delete obsolete `stores/dialogs.js` and `stores/optionPicker.js`; the
   reference check already confirms the dialog service is the only active path.

## Non-findings

The audit found no remaining `window.dispatchEvent` component-to-runtime bus,
no direct DOM lookup in `appCompositionRoot.js`, and no feature-action imports
in `Overlays.svelte`.
