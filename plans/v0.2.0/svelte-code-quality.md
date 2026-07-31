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
- [ ] `public/src/components/Composer.svelte`
- [ ] `public/src/components/ConfirmPromptModal.svelte`
- [ ] `public/src/components/CredentialsModal.svelte`
- [ ] `public/src/components/EditorPromptModal.svelte`
- [ ] `public/src/components/FileExplorerModal.svelte`
- [ ] `public/src/components/FilePickerModal.svelte`
- [ ] `public/src/components/FolderBrowserModal.svelte`
- [ ] `public/src/components/FolderIcon.svelte`
- [ ] `public/src/components/Header.svelte`
- [ ] `public/src/components/HtmlArtifact.svelte`
- [ ] `public/src/components/HublotManagerModal.svelte`
- [ ] `public/src/components/HublotSidebar.svelte`
- [ ] `public/src/components/ImageArtifact.svelte`
- [ ] `public/src/components/LlmboxWorkspaceModal.svelte`
- [ ] `public/src/components/MarkdownArtifact.svelte`
- [ ] `public/src/components/Menu.svelte`
- [ ] `public/src/components/OptionPickerItem.svelte`
- [ ] `public/src/components/OptionPickerModal.svelte`
- [ ] `public/src/components/Overlays.svelte`
- [ ] `public/src/components/PinnedWidgetGrid.svelte`
- [ ] `public/src/components/PinnedWidgetViewerModal.svelte`
- [ ] `public/src/components/RoutineList.svelte`
- [ ] `public/src/components/RoutineManagerModal.svelte`
- [ ] `public/src/components/SanitizedMarkdown.svelte`
- [ ] `public/src/components/SearchHitSnippet.svelte`
- [ ] `public/src/components/SessionPickerModal.svelte`
- [ ] `public/src/components/SessionSidebar.svelte`
- [ ] `public/src/components/SettingsModal.svelte`
- [ ] `public/src/components/Sidebars.svelte`
- [ ] `public/src/components/SvgArtifact.svelte`
- [ ] `public/src/components/TextPromptModal.svelte`
- [ ] `public/src/components/ToastItem.svelte`
- [ ] `public/src/components/Toasts.svelte`
- [ ] `public/src/components/Transcript.svelte`
- [ ] `public/src/components/VideoArtifact.svelte`

## Transcript components

- [ ] `public/src/components/transcript/ActivityStack.svelte`
- [ ] `public/src/components/transcript/AssistantMessage.svelte`
- [ ] `public/src/components/transcript/AssistantPartActions.svelte`
- [ ] `public/src/components/transcript/CheckpointButton.svelte`
- [ ] `public/src/components/transcript/CheckpointRestoreButton.svelte`
- [ ] `public/src/components/transcript/CompactionMarker.svelte`
- [ ] `public/src/components/transcript/CopyMessageButton.svelte`
- [ ] `public/src/components/transcript/PermalinkButton.svelte`
- [ ] `public/src/components/transcript/ToolCard.svelte`
- [ ] `public/src/components/transcript/UserMessage.svelte`
