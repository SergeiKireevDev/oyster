<script>
  import BrowserDirectoryList from "./BrowserDirectoryList.svelte";
  import { updateFileExplorer } from "../stores/fileExplorer.js";
  import { closeModalState } from "../stores/modal.js";
  import { getBrowserActions } from "../runtime/browserActionsContext.js";
  import { browserPathFor, fmtFileSize, visibleBrowserEntries } from "../lib/fileBrowser.js";
  import { fileExplorer } from "../stores/fileExplorer.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    FILE_EXPLORER_BACK_ACTION,
    FILE_EXPLORER_BROWSE_ACTION,
    FILE_EXPLORER_EDIT_ACTION,
    FILE_EXPLORER_RETURN_TO_HUBLOTS_ACTION,
    FILE_EXPLORER_SAVE_ACTION,
    FILE_EXPLORER_UPLOAD_ACTION,
  } from "../runtime/uiActionNames.js";

  const browserActions = getBrowserActions();
  const uiActions = getUiActionRegistry();
  const browseFileExplorer = (path) => uiActions.invoke(FILE_EXPLORER_BROWSE_ACTION, path);
  const editExploredFile = (path) => uiActions.invoke(FILE_EXPLORER_EDIT_ACTION, path);
  const saveFileExplorer = () => uiActions.invoke(FILE_EXPLORER_SAVE_ACTION);
  const saveExploredFile = saveFileExplorer;
  const uploadFileExplorer = () => uiActions.invoke(FILE_EXPLORER_UPLOAD_ACTION);
  const backFileExplorer = () => uiActions.invoke(FILE_EXPLORER_BACK_ACTION);
  const backFileExplorerToHublots = () => uiActions.invoke(FILE_EXPLORER_RETURN_TO_HUBLOTS_ACTION);

  $: files = visibleBrowserEntries($fileExplorer.files, $fileExplorer.showHidden);
  $: editedFileDownload = browserActions.fileDownload($fileExplorer.token, $fileExplorer.editPath);
</script>

{#if $fileExplorer.loading}
  <div class="m-path"><span class="spin"></span> loading files…</div>
{:else if $fileExplorer.mode === "edit"}
  <div class="m-path">{$fileExplorer.editPath}</div>
  <textarea
    value={$fileExplorer.editContent}
    spellcheck="false"
    style="width:100%;height:50vh;resize:vertical;font:12.5px/1.5 ui-monospace,monospace;white-space:pre;tab-size:4;box-sizing:border-box;margin-top:6px;"
    oninput={(event) => updateFileExplorer({ editContent: event.currentTarget.value })}
    onkeydown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        saveExploredFile();
      }
    }}
  ></textarea>
{:else}
  <BrowserDirectoryList
    path={$fileExplorer.path}
    home={$fileExplorer.home}
    workdir={$fileExplorer.workdir}
    parent={$fileExplorer.parent}
    dirs={$fileExplorer.dirs}
    showHidden={$fileExplorer.showHidden}
    showWorkdir={true}
    onBrowse={browseFileExplorer}
  />
  {#each files as file (file.name)}
    {@const fullPath = browserPathFor($fileExplorer.path, file)}
    {@const download = browserActions.fileDownload($fileExplorer.token, fullPath)}
    <div style="display:flex;align-items:center;gap:6px;">
      <button class={`m-option file ${file.hidden ? "hidden-entry" : ""}`.trim()} style="flex:1;min-width:0;" title={fullPath} onclick={() => editExploredFile(fullPath)}>
        {file.name}<span class="f-size">{fmtFileSize(file.size)}</span>
      </button>
      <a
        class="chip"
        href={download.href}
        download={download.filename}
        title={`download ${file.name}`}
        style="text-decoration:none"
      >⬇</a>
      <button class="chip" title={`edit ${file.name}`} onclick={() => editExploredFile(fullPath)}>✎</button>
    </div>
  {/each}
  {#if !visibleBrowserEntries($fileExplorer.dirs, $fileExplorer.showHidden).length && !files.length}
    <div class="m-path">(empty folder)</div>
  {/if}
{/if}

<div class="m-actions" id="mActions">
  {#if $fileExplorer.mode === "edit"}
    <button class="chip" onclick={saveFileExplorer}>{$fileExplorer.saving ? "Saving…" : "Save"}</button>
    <a class="chip" href={editedFileDownload.href} download={editedFileDownload.filename} style="text-decoration:none">Download</a>
    <button class="chip" onclick={backFileExplorer}>← Back</button>
  {:else}
    <button class="chip" title={`upload local files to ${$fileExplorer.path}`} onclick={uploadFileExplorer}>{$fileExplorer.uploading ? "" : ""}{@html $fileExplorer.uploadText}</button>
    <button class="chip toggle-hidden" onclick={() => updateFileExplorer({ showHidden: !$fileExplorer.showHidden })}>{$fileExplorer.showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles"}</button>
    <button class="chip" onclick={backFileExplorerToHublots}>← Hublots</button>
  {/if}
  <button class="chip" onclick={closeModalState}>Close</button>
</div>
