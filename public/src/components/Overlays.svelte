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
  import { cancelCheckpointModelPicker, submitCheckpointModelPicker, checkpointModelPicker } from "../stores/checkpointModelPicker.js";
  import { answerConfirmPrompt, cancelEditorPrompt, cancelTextPrompt, submitEditorPrompt, submitTextPrompt } from "../stores/dialogs.js";
  import { backToExploredList, backToHublotsFromExplorer, cancelFilePicker, cancelFolderBrowser, cancelSessionPicker, saveExploredFile, showFolderCreateRow, submitFolderBrowser, toggleFileExplorerHidden, toggleFilePickerHidden, toggleFolderHidden, uploadExploredFiles, usePickedFolder } from "../lib/legacyBridge.js";
  import { fileExplorer } from "../stores/fileExplorer.js";
  import { filePicker } from "../stores/filePicker.js";
  import { folderBrowser } from "../stores/folderBrowser.js";
  import { hublotManager } from "../stores/hublotManager.js";
  import { cancelOptionPicker } from "../stores/optionPicker.js";
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
          onclick={cancelOptionPicker}
          onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") cancelOptionPicker(); }}
        >Cancel</span>
      {:else if $modalState.content === "textPrompt"}
        <span class="chip" role="button" tabindex="0" onclick={cancelTextPrompt} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") cancelTextPrompt(); }}>Cancel</span>
        <button class="btn" style="padding:6px 16px;" onclick={submitTextPrompt}>OK</button>
      {:else if $modalState.content === "editorPrompt"}
        <span class="chip" role="button" tabindex="0" onclick={cancelEditorPrompt} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") cancelEditorPrompt(); }}>Cancel</span>
        <button class="btn" style="padding:6px 16px;" onclick={submitEditorPrompt}>OK</button>
      {:else if $modalState.content === "confirmPrompt"}
        <span class="chip" role="button" tabindex="0" onclick={() => answerConfirmPrompt(false)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") answerConfirmPrompt(false); }}>No</span>
        <button class="btn" style="padding:6px 16px;" onclick={() => answerConfirmPrompt(true)}>Yes</button>
      {:else if $modalState.content === "checkpointModelPicker"}
        <span class="chip" role="button" tabindex="0" onclick={cancelCheckpointModelPicker} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") cancelCheckpointModelPicker(); }}>Cancel</span>
        <button class="btn" style="padding:6px 16px;" onclick={submitCheckpointModelPicker}>{$checkpointModelPicker.okLabel}</button>
      {:else if $modalState.content === "hublotManager"}
        <span class="chip" role="button" tabindex="0" title="toggle between this session's tunnels and all of them" onclick={() => window.dispatchEvent(new Event("pi-managed-hublot-toggle-scope"))} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") window.dispatchEvent(new Event("pi-managed-hublot-toggle-scope")); }}>{$hublotManager.scopeAll ? "This session only" : "All sessions"}</span>
        <span class="chip" role="button" tabindex="0" onclick={closeModalState} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") closeModalState(); }}>Close</span>
      {:else if $modalState.content === "folderBrowser"}
        <span class="chip" role="button" tabindex="0" onclick={showFolderCreateRow} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") showFolderCreateRow(); }}>New folder</span>
        <span class="chip toggle-hidden" role="button" tabindex="0" onclick={toggleFolderHidden} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") toggleFolderHidden(); }}>{$folderBrowser.showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles"}</span>
        <span class="chip" role="button" tabindex="0" onclick={cancelFolderBrowser} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") cancelFolderBrowser(); }}>Cancel</span>
        <button class="btn" style="padding:6px 16px;" onclick={submitFolderBrowser}>Start session here</button>
      {:else if $modalState.content === "filePicker"}
        <span class="chip" role="button" tabindex="0" title="Insert the current folder path" onclick={usePickedFolder} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") usePickedFolder(); }}>📁 Use this folder</span>
        <span class="chip toggle-hidden" role="button" tabindex="0" onclick={toggleFilePickerHidden} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") toggleFilePickerHidden(); }}>{$filePicker.showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles"}</span>
        <span class="chip" role="button" tabindex="0" onclick={cancelFilePicker} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") cancelFilePicker(); }}>Cancel</span>
      {:else if $modalState.content === "fileExplorer" && $fileExplorer.mode === "edit"}
        <span class="chip" role="button" tabindex="0" onclick={saveExploredFile} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") saveExploredFile(); }}>{$fileExplorer.saving ? "Saving…" : "Save"}</span>
        <a class="chip" href={`/file-download?token=${encodeURIComponent($fileExplorer.token)}&path=${encodeURIComponent($fileExplorer.editPath)}`} download={$fileExplorer.editPath.split("/").pop()} style="text-decoration:none">Download</a>
        <span class="chip" role="button" tabindex="0" onclick={backToExploredList} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") backToExploredList(); }}>← Back</span>
        <span class="chip" role="button" tabindex="0" onclick={closeModalState} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") closeModalState(); }}>Close</span>
      {:else if $modalState.content === "fileExplorer"}
        <span class="chip" role="button" tabindex="0" title={`upload local files to ${$fileExplorer.path}`} onclick={uploadExploredFiles} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") uploadExploredFiles(); }}>{$fileExplorer.uploading ? "" : ""}{@html $fileExplorer.uploadText}</span>
        <span class="chip toggle-hidden" role="button" tabindex="0" onclick={toggleFileExplorerHidden} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") toggleFileExplorerHidden(); }}>{$fileExplorer.showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles"}</span>
        <span class="chip" role="button" tabindex="0" onclick={backToHublotsFromExplorer} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") backToHublotsFromExplorer(); }}>← Hublots</span>
        <span class="chip" role="button" tabindex="0" onclick={closeModalState} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") closeModalState(); }}>Close</span>
      {:else if $modalState.content === "sessionPicker"}
        <span class="chip" role="button" tabindex="0" onclick={cancelSessionPicker} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") cancelSessionPicker(); }}>Cancel</span>
      {/if}
    </div>
  {/if}
</div></div>

<Toasts />

<CommandPalette />
