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
  import { closeModalState, modalState } from "../stores/modal.js";
  import { getDialogService } from "../runtime/dialogServiceContext.js";
  import { cancelSessionPicker } from "../features/sessions/sessionPickerActions.js";

  const dialogs = getDialogService();
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

    <div class="m-actions" id="mActions">
      {#if $modalState.content === "settings"}
        <button class="btn" onclick={closeModalState}>Done</button>
      {:else if $modalState.content === "optionPicker"}
        <span
          class="chip"
          role="button"
          tabindex="0"
          onclick={dialogs.cancelOption}
          onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") dialogs.cancelOption(); }}
        >Cancel</span>
      {:else if $modalState.content === "textPrompt"}
        <span class="chip" role="button" tabindex="0" onclick={dialogs.cancelText} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") dialogs.cancelText(); }}>Cancel</span>
        <button class="btn" style="padding:6px 16px;" onclick={dialogs.submitText}>OK</button>
      {:else if $modalState.content === "editorPrompt"}
        <span class="chip" role="button" tabindex="0" onclick={dialogs.cancelEditor} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") dialogs.cancelEditor(); }}>Cancel</span>
        <button class="btn" style="padding:6px 16px;" onclick={dialogs.submitEditor}>OK</button>
      {:else if $modalState.content === "confirmPrompt"}
        <span class="chip" role="button" tabindex="0" onclick={() => dialogs.answerConfirm(false)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") dialogs.answerConfirm(false); }}>No</span>
        <button class="btn" style="padding:6px 16px;" onclick={() => dialogs.answerConfirm(true)}>Yes</button>
      {:else if $modalState.content === "sessionPicker"}
        <span class="chip" role="button" tabindex="0" onclick={cancelSessionPicker} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") cancelSessionPicker(); }}>Cancel</span>
      {/if}
    </div>
  {/if}
</div></div>

<Toasts />

<CommandPalette />
