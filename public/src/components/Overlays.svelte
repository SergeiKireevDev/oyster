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
  import { fileExplorer, updateFileExplorer } from "../stores/fileExplorer.js";
  import { backFileExplorer, backFileExplorerToHublots, saveFileExplorer, uploadFileExplorer } from "../features/files/fileExplorerActions.js";
  import { filePicker, updateFilePicker } from "../stores/filePicker.js";
  import { cancelFilePicker, useFilePickerFolder } from "../features/files/filePickerActions.js";
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
      {:else if $modalState.content === "filePicker"}
        <span class="chip" role="button" tabindex="0" title="Insert the current folder path" onclick={useFilePickerFolder} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") useFilePickerFolder(); }}>📁 Use this folder</span>
        <span class="chip toggle-hidden" role="button" tabindex="0" onclick={() => updateFilePicker({ showHidden: !$filePicker.showHidden })} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") updateFilePicker({ showHidden: !$filePicker.showHidden }); }}>{$filePicker.showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles"}</span>
        <span class="chip" role="button" tabindex="0" onclick={cancelFilePicker} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") cancelFilePicker(); }}>Cancel</span>
      {:else if $modalState.content === "fileExplorer" && $fileExplorer.mode === "edit"}
        <span class="chip" role="button" tabindex="0" onclick={saveFileExplorer} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") saveFileExplorer(); }}>{$fileExplorer.saving ? "Saving…" : "Save"}</span>
        <a class="chip" href={`/file-download?token=${encodeURIComponent($fileExplorer.token)}&path=${encodeURIComponent($fileExplorer.editPath)}`} download={$fileExplorer.editPath.split("/").pop()} style="text-decoration:none">Download</a>
        <span class="chip" role="button" tabindex="0" onclick={backFileExplorer} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") backFileExplorer(); }}>← Back</span>
        <span class="chip" role="button" tabindex="0" onclick={closeModalState} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") closeModalState(); }}>Close</span>
      {:else if $modalState.content === "fileExplorer"}
        <span class="chip" role="button" tabindex="0" title={`upload local files to ${$fileExplorer.path}`} onclick={uploadFileExplorer} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") uploadFileExplorer(); }}>{$fileExplorer.uploading ? "" : ""}{@html $fileExplorer.uploadText}</span>
        <span class="chip toggle-hidden" role="button" tabindex="0" onclick={() => updateFileExplorer({ showHidden: !$fileExplorer.showHidden })} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") updateFileExplorer({ showHidden: !$fileExplorer.showHidden }); }}>{$fileExplorer.showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles"}</span>
        <span class="chip" role="button" tabindex="0" onclick={backFileExplorerToHublots} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") backFileExplorerToHublots(); }}>← Hublots</span>
        <span class="chip" role="button" tabindex="0" onclick={closeModalState} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") closeModalState(); }}>Close</span>
      {:else if $modalState.content === "sessionPicker"}
        <span class="chip" role="button" tabindex="0" onclick={cancelSessionPicker} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") cancelSessionPicker(); }}>Cancel</span>
      {/if}
    </div>
  {/if}
</div></div>

<Toasts />

<CommandPalette />
