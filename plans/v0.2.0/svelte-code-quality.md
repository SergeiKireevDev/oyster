# Per-File Svelte Code-Quality Loop

## Iteration prompt

Work on exactly one unchecked file from the checklist per iteration: the file named by the current checkbox. Inspect the entire file and find all code smells, then fix every issue you find and enhance the file's overall code quality. Review correctness, Svelte reactivity and state ownership, lifecycle and resource cleanup, component boundaries, accessibility, semantic markup, performance, readability, duplication, dead code, styling boundaries, and maintainability. Preserve intended behavior and avoid unrelated changes outside the selected file. Run the relevant focused tests and the repository test suite (`npm test`) after making changes. Check off the item only when the selected file has been fully reviewed, all identified issues have been resolved, and validation passes.

## Application root

- [x] `public/src/App.svelte`

## Components

- [x] `public/src/components/AnalyticsModal.svelte`
- [x] `public/src/components/AppIcon.svelte`
- [x] `public/src/components/ArtifactLoadState.svelte`
- [x] `public/src/components/AuthGate.svelte`
- [x] `public/src/components/BrowserDirectoryList.svelte`
- [x] `public/src/components/BrowserFileEntry.svelte`
- [x] `public/src/components/CarouselIndicator.svelte`
- [x] `public/src/components/ChatLayout.svelte`
- [x] `public/src/components/CheckpointModelPickerModal.svelte`
- [x] `public/src/components/CheckpointTreebar.svelte`
- [x] `public/src/components/CheckpointTreeNode.svelte`
- [x] `public/src/components/CloudWorkspaceModal.svelte`
- [x] `public/src/components/CommandPalette.svelte`
- [x] `public/src/components/Composer.svelte`
- [x] `public/src/components/ConfirmPromptModal.svelte`
- [x] `public/src/components/CredentialsModal.svelte`
- [x] `public/src/components/EditorPromptModal.svelte`
- [x] `public/src/components/FileExplorerModal.svelte`
- [x] `public/src/components/FilePickerModal.svelte`
- [x] `public/src/components/FolderBrowserModal.svelte`
- [x] `public/src/components/FolderIcon.svelte`
- [x] `public/src/components/Header.svelte`
- [x] `public/src/components/HtmlArtifact.svelte`
- [x] `public/src/components/HublotManagerModal.svelte`
- [x] `public/src/components/HublotSidebar.svelte`
- [x] `public/src/components/ImageArtifact.svelte`
- [x] `public/src/components/LlmboxWorkspaceModal.svelte`
- [x] `public/src/components/MarkdownArtifact.svelte`
- [x] `public/src/components/Menu.svelte`
- [x] `public/src/components/OptionPickerItem.svelte`
- [x] `public/src/components/OptionPickerModal.svelte`
- [x] `public/src/components/Overlays.svelte`
- [x] `public/src/components/PinnedWidgetGrid.svelte`
- [x] `public/src/components/PinnedWidgetViewerModal.svelte`
- [x] `public/src/components/RoutineList.svelte`
- [x] `public/src/components/RoutineManagerModal.svelte`
- [x] `public/src/components/SanitizedMarkdown.svelte`
- [x] `public/src/components/SearchHitSnippet.svelte`
- [x] `public/src/components/SessionPickerModal.svelte`
- [x] `public/src/components/SessionSidebar.svelte`
- [x] `public/src/components/SettingsModal.svelte`
- [x] `public/src/components/Sidebars.svelte`
- [x] `public/src/components/SvgArtifact.svelte`
- [x] `public/src/components/TextPromptModal.svelte`
- [x] `public/src/components/ToastItem.svelte`
- [x] `public/src/components/Toasts.svelte`
- [x] `public/src/components/Transcript.svelte`
- [x] `public/src/components/VideoArtifact.svelte`

## Transcript components

- [x] `public/src/components/transcript/ActivityStack.svelte`
- [x] `public/src/components/transcript/AssistantMessage.svelte`
- [x] `public/src/components/transcript/AssistantPartActions.svelte`
- [x] `public/src/components/transcript/CheckpointButton.svelte`
- [x] `public/src/components/transcript/CheckpointRestoreButton.svelte`
- [x] `public/src/components/transcript/CompactionMarker.svelte`
- [x] `public/src/components/transcript/CopyMessageButton.svelte`
- [x] `public/src/components/transcript/PermalinkButton.svelte`
- [x] `public/src/components/transcript/ToolCard.svelte`
- [x] `public/src/components/transcript/UserMessage.svelte`
