<script>
  import BrowserDirectoryList from "./BrowserDirectoryList.svelte";
  import BrowserFileEntry from "./BrowserFileEntry.svelte";
  import FolderIcon from "./FolderIcon.svelte";
  import { browserPathFor, visibleBrowserEntries } from "../lib/fileBrowser.js";
  import {
    DEFAULT_COLLECTION_PAGE_SIZE,
    incrementalCollectionPage,
    nextCollectionPageCount,
  } from "../lib/incrementalCollection.js";
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

  function toggleHiddenFiles() {
    updateFilePicker({ showHidden: !$filePicker.showHidden });
  }

  function retryFilePicker() {
    browseFilePicker($filePicker.path || undefined);
  }

  let requestedFiles = DEFAULT_COLLECTION_PAGE_SIZE;
  let filePageIdentity = null;

  $: files = visibleBrowserEntries($filePicker.files, $filePicker.showHidden);
  $: directories = visibleBrowserEntries($filePicker.dirs, $filePicker.showHidden);
  $: nextFilePageIdentity = `${$filePicker.path}\0${$filePicker.showHidden}`;
  $: if (nextFilePageIdentity !== filePageIdentity) {
    filePageIdentity = nextFilePageIdentity;
    requestedFiles = DEFAULT_COLLECTION_PAGE_SIZE;
  }
  $: filePage = incrementalCollectionPage(files, requestedFiles);
  $: nextFilePageSize = Math.min(filePage.pageSize, filePage.remainingCount);
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
  <div class="m-path" role="status"><span class="spin" aria-hidden="true"></span> loading files…</div>
{:else if $filePicker.error}
  <div class="m-path async-error" role="alert">
    <span>Could not load files: {$filePicker.error}</span>
    <button class="chip" type="button" onclick={retryFilePicker}>Retry</button>
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
  {#if filePage.items.length}
    <div role="list" aria-label="Files">
      {#each filePage.items as file (file.name)}
        {@const fullPath = browserPathFor($filePicker.path, file)}
        <div role="listitem">
          <BrowserFileEntry {file} path={fullPath} onOpen={pickFilePicker} />
        </div>
      {/each}
    </div>
  {/if}
  {#if filePage.remainingCount}
    <button type="button" class="collection-load-more" onclick={revealFiles}>Show {nextFilePageSize} more files</button>
  {/if}
  {#if folderIsEmpty}
    <div class="m-path" role="status">(empty folder)</div>
  {/if}
{/if}

<div class="m-actions" id="mActions">
  <button class="chip folder-action" type="button" title="Insert the current folder path" onclick={useFilePickerFolder}><FolderIcon size={14} /> Use this folder</button>
  <button
    class="chip toggle-hidden"
    class:active={$filePicker.showHidden}
    type="button"
    aria-pressed={$filePicker.showHidden}
    onclick={toggleHiddenFiles}
  >{hiddenFilesLabel}</button>
  <button class="chip" type="button" data-modal-cancel onclick={cancelFilePicker}>Cancel</button>
</div>
