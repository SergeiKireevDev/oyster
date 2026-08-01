# Style Unification Plan

## Required style guidelines

Before working on each checklist item, read and follow [`style-guidelines.md`](./style-guidelines.md). Treat it as the canonical reference for the application's current visual language and implementation conventions.

In particular:

- Follow the calm, low-glare, spatial visual direction established by the later **2026 visual system** section of `public/src/style.css`; account for the stylesheet's order-dependent cascade.
- Reuse semantic theme tokens, shared global classes, and existing role-based patterns—especially `.chip`, `.btn`, `.m-option`, and `.m-actions`—rather than creating one-off styling.
- Keep dark and light themes aligned. Prefer semantic custom properties and verify any necessary literal or translucent color has an appropriate light-theme treatment.
- Match established typography, compact spacing, restrained radii, fine borders, layered surfaces, soft elevation, shared icons, and semantic status colors.
- Implement every applicable default, hover, focus-visible, selected/current, disabled, loading, empty, error, warning, and success state.
- Preserve keyboard focus, accessible labels, semantic elements, contrast, reduced-motion behavior, and non-color state cues.
- Verify desktop, tablet (`1080px`), and mobile (`760px`, `600px`, and `520px` where relevant), including touch targets, overflow, safe-area spacing, and long dynamic content.
- Keep shared visual contracts in the global stylesheet and component-specific rendering in scoped styles. Remove duplicated or obsolete styling instead of adding another override layer.
- Do not add smooth scrolling to the transcript; its programmatic positioning requires immediate scroll updates.
- Preserve existing behavior and run the required tests after focused changes.

For each checklist item, review the referenced Svelte component and consolidate its visual style with the rest of the application. Apply the full guidelines—not only the summary above—and compare the component with existing components serving the same visual role.

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
