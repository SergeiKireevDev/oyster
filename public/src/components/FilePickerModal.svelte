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
  $: hiddenFilesLabel = $filePicker.showHidden ? "Hide hidden files" : "Show hidden files";

  function revealFiles() {
    requestedFiles = nextCollectionPageCount(
      filePage.visibleCount,
      filePage.visibleCount + filePage.remainingCount,
      filePage.pageSize,
    );
  }
</script>

{#if $filePicker.loading}
  <div class="file-picker-state" role="status">
    <span class="spin" aria-hidden="true"></span>
    <span>Loading files…</span>
  </div>
{:else if $filePicker.error}
  <div class="file-picker-state file-picker-error async-error" role="alert">
    <span>Could not load files: {$filePicker.error}</span>
    <button class="chip" type="button" onclick={retryFilePicker}>Retry</button>
  </div>
{:else}
  <div class="file-picker-browser">
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
      <div class="file-picker-files" role="list" aria-label="Files">
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
      <div class="file-picker-empty" role="status">This folder is empty.</div>
    {/if}
  </div>
{/if}

<div class="m-actions" id="mActions">
  <button class="btn modal-primary-action folder-action" type="button" title="Insert the current folder path" onclick={useFilePickerFolder}><FolderIcon size={14} /> Use this folder</button>
  <button
    class="chip toggle-hidden"
    class:active={$filePicker.showHidden}
    type="button"
    aria-pressed={$filePicker.showHidden}
    onclick={toggleHiddenFiles}
  >{hiddenFilesLabel}</button>
  <button class="chip" type="button" data-modal-cancel onclick={cancelFilePicker}>Cancel</button>
</div>

<style>
  .file-picker-browser,
  .file-picker-files {
    display: grid;
    min-width: 0;
    gap: 5px;
  }

  .file-picker-state,
  .file-picker-empty {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .file-picker-state {
    display: flex;
    min-height: 80px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-align: center;
  }

  .file-picker-error {
    flex-wrap: wrap;
    color: var(--red);
  }

  .file-picker-empty {
    padding: 22px 12px;
    border: 1px dashed var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel-2) 42%, transparent);
    text-align: center;
  }

  .folder-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
  }

  .toggle-hidden.active {
    border-color: var(--selection-border);
    background: var(--selection-bg);
    color: var(--selection-text);
    box-shadow: inset 0 -1px 0 var(--selection-marker);
  }

  @media (max-width: 760px) {
    .m-actions > button { min-height: 40px; }
  }

  @media (max-width: 520px) {
    .m-actions > button { flex: 1 1 132px; }
    .m-actions > .folder-action { order: -1; flex-basis: 100%; }
  }
</style>
