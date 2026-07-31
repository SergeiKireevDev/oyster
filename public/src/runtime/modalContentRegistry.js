import AnalyticsModal from "../components/AnalyticsModal.svelte";
import CheckpointModelPickerModal from "../components/CheckpointModelPickerModal.svelte";
import CloudWorkspaceModal from "../components/CloudWorkspaceModal.svelte";
import ConfirmPromptModal from "../components/ConfirmPromptModal.svelte";
import CredentialsModal from "../components/CredentialsModal.svelte";
import EditorPromptModal from "../components/EditorPromptModal.svelte";
import FileExplorerModal from "../components/FileExplorerModal.svelte";
import FilePickerModal from "../components/FilePickerModal.svelte";
import FolderBrowserModal from "../components/FolderBrowserModal.svelte";
import HublotManagerModal from "../components/HublotManagerModal.svelte";
import LlmboxWorkspaceModal from "../components/LlmboxWorkspaceModal.svelte";
import OptionPickerModal from "../components/OptionPickerModal.svelte";
import PinnedWidgetViewerModal from "../components/PinnedWidgetViewerModal.svelte";
import RoutineManagerModal from "../components/RoutineManagerModal.svelte";
import SessionPickerModal from "../components/SessionPickerModal.svelte";
import SettingsModal from "../components/SettingsModal.svelte";
import TextPromptModal from "../components/TextPromptModal.svelte";

const modalComponents = Object.freeze({
  analytics: AnalyticsModal,
  checkpointModelPicker: CheckpointModelPickerModal,
  cloudWorkspace: CloudWorkspaceModal,
  confirmPrompt: ConfirmPromptModal,
  credentials: CredentialsModal,
  editorPrompt: EditorPromptModal,
  fileExplorer: FileExplorerModal,
  filePicker: FilePickerModal,
  folderBrowser: FolderBrowserModal,
  hublotManager: HublotManagerModal,
  llmboxWorkspace: LlmboxWorkspaceModal,
  optionPicker: OptionPickerModal,
  pinnedWidgetViewer: PinnedWidgetViewerModal,
  routineManager: RoutineManagerModal,
  sessionPicker: SessionPickerModal,
  settings: SettingsModal,
  textPrompt: TextPromptModal,
});

function modalProps(content, context) {
  if (content === "cloudWorkspace") return { providerId: context?.providerId || "" };
  if (content === "llmboxWorkspace") return {
    spoke: context?.spoke || "",
    environmentName: context?.environmentName || "",
  };
  return {};
}

/**
 * The application composition boundary owns the modal-name to component mapping.
 * The overlay component remains feature-agnostic and only coordinates dialog chrome.
 */
export function resolveModalContent(content, context) {
  const component = modalComponents[content];
  return component ? { component, props: modalProps(content, context) } : null;
}

export const modalContentNames = Object.freeze(Object.keys(modalComponents));
