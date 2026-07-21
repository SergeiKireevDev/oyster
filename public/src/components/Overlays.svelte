<script>
  import CarouselDots from "./CarouselDots.svelte";
  import CheckpointModelPickerModal from "./CheckpointModelPickerModal.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import ConfirmPromptModal from "./ConfirmPromptModal.svelte";
  import EditorPromptModal from "./EditorPromptModal.svelte";
  import FileExplorerModal from "./FileExplorerModal.svelte";
  import FilePickerModal from "./FilePickerModal.svelte";
  import FolderBrowserModal from "./FolderBrowserModal.svelte";
  import HublotManagerModal from "./HublotManagerModal.svelte";
  import OptionPickerModal from "./OptionPickerModal.svelte";
  import SettingsModal from "./SettingsModal.svelte";
  import SessionPickerModal from "./SessionPickerModal.svelte";
  import TextPromptModal from "./TextPromptModal.svelte";
  import Toasts from "./Toasts.svelte";
  import { modalState } from "../stores/modal.js";
</script>

<CarouselDots />

<div id="overlay" class:open={$modalState.open}><div id="modal" class:wide={$modalState.wide}>
  <div class="m-title" id="mTitle">{$modalState.title}</div>

  {#if $modalState.content === null}
    <div class="m-body" id="mBody"></div>
    <div class="m-actions" id="mActions"></div>
  {:else}
    <div class="m-body" id="mBody">
      {#if $modalState.content === "settings"}
        <SettingsModal />
      {:else if $modalState.content === "optionPicker"}
        <OptionPickerModal />
      {:else if $modalState.content === "textPrompt"}
        <TextPromptModal />
      {:else if $modalState.content === "editorPrompt"}
        <EditorPromptModal />
      {:else if $modalState.content === "confirmPrompt"}
        <ConfirmPromptModal />
      {:else if $modalState.content === "checkpointModelPicker"}
        <CheckpointModelPickerModal />
      {:else if $modalState.content === "hublotManager"}
        <HublotManagerModal />
      {:else if $modalState.content === "folderBrowser"}
        <FolderBrowserModal />
      {:else if $modalState.content === "filePicker"}
        <FilePickerModal />
      {:else if $modalState.content === "fileExplorer"}
        <FileExplorerModal />
      {:else if $modalState.content === "sessionPicker"}
        <SessionPickerModal />
      {/if}
    </div>
  {/if}
</div></div>

<Toasts />

<CommandPalette />
