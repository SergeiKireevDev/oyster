<script>
  import BrowserDirectoryList from "./BrowserDirectoryList.svelte";
  import BrowserFileEntry from "./BrowserFileEntry.svelte";
  import FolderIcon from "./FolderIcon.svelte";
  import { browserPathFor, visibleBrowserEntries } from "../lib/fileBrowser.js";
  import { incrementalCollectionPage, nextCollectionPageCount } from "../lib/incrementalCollection.js";
  import { filePicker, updateFilePicker } from "../stores/filePicker.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    FILE_PICKER_BROWSE_ACTION,
    FILE_PICKER_CANCEL_ACTION,
    FILE_PICKER_CHOOSE_ACTION,
    FILE_PICKER_USE_FOLDER_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const browseFilePicker = (path) => uiActions.invoke(FILE_PICKER_BROWSE_ACTION, path);
  const pickFilePicker = (path) => uiActions.invoke(FILE_PICKER_CHOOSE_ACTION, path);
  const useFilePickerFolder = () => uiActions.invoke(FILE_PICKER_USE_FOLDER_ACTION);
  const cancelFilePicker = () => uiActions.invoke(FILE_PICKER_CANCEL_ACTION);

  const toggleHiddenFiles = () => updateFilePicker({ showHidden: !$filePicker.showHidden });

  let requestedFiles = 40;
  let filePageIdentity = null;

  $: files = visibleBrowserEntries($filePicker.files, $filePicker.showHidden);
  $: directories = visibleBrowserEntries($filePicker.dirs, $filePicker.showHidden);
  $: nextFilePageIdentity = `${$filePicker.path}\0${$filePicker.showHidden}`;
  $: if (nextFilePageIdentity !== filePageIdentity) {
    filePageIdentity = nextFilePageIdentity;
    requestedFiles = 40;
  }
  $: filePage = incrementalCollectionPage(files, requestedFiles);
  $: folderIsEmpty = !directories.length && !files.length;
  $: hiddenFilesLabel = $filePicker.showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles";

  function revealFiles() {
    requestedFiles = nextCollectionPageCount(
      filePage.visibleCount,
      filePage.visibleCount + filePage.remainingCount,
      filePage.pageSize,
    );
  }
</script>

{#if $filePicker.loading}
  <div class="m-path" role="status"><span class="spin"></span> loading files…</div>
{:else if $filePicker.error}
  <div class="m-path async-error" role="alert">
    <span>Could not load files: {$filePicker.error}</span>
    <button class="chip" type="button" onclick={() => browseFilePicker($filePicker.path || undefined)}>Retry</button>
  </div>
{:else}
  <BrowserDirectoryList
    path={$filePicker.path}
    home={$filePicker.home}
    workdir={$filePicker.workdir}
    parent={$filePicker.parent}
    dirs={$filePicker.dirs}
    showHidden={$filePicker.showHidden}
    showWorkdir={true}
    onBrowse={browseFilePicker}
  />
  {#each filePage.items as file (file.name)}
    {@const fullPath = browserPathFor($filePicker.path, file)}
    <BrowserFileEntry {file} path={fullPath} onOpen={pickFilePicker} />
  {/each}
  {#if filePage.remainingCount}
    <button type="button" class="collection-load-more" onclick={revealFiles}>Show {Math.min(filePage.pageSize, filePage.remainingCount)} more files</button>
  {/if}
  {#if folderIsEmpty}
    <div class="m-path">(empty folder)</div>
  {/if}
{/if}

<div class="m-actions" id="mActions">
  <button class="chip folder-action" title="Insert the current folder path" onclick={useFilePickerFolder}><FolderIcon size={14} /> Use this folder</button>
  <button class="chip toggle-hidden" onclick={toggleHiddenFiles}>{hiddenFilesLabel}</button>
  <button class="chip" data-modal-cancel onclick={cancelFilePicker}>Cancel</button>
</div>
