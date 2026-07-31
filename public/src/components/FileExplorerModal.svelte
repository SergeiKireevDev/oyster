<script>
  import BrowserDirectoryList from "./BrowserDirectoryList.svelte";
  import BrowserFileEntry from "./BrowserFileEntry.svelte";
  import { fileExplorer, updateFileExplorer } from "../stores/fileExplorer.js";
  import { closeModalState } from "../stores/modal.js";
  import { getBrowserActions } from "../runtime/browserActionsContext.js";
  import { browserPathFor, visibleBrowserEntries } from "../lib/fileBrowser.js";
  import {
    DEFAULT_COLLECTION_PAGE_SIZE,
    incrementalCollectionPage,
    nextCollectionPageCount,
  } from "../lib/incrementalCollection.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    FILE_EXPLORER_BACK_ACTION,
    FILE_EXPLORER_BROWSE_ACTION,
    FILE_EXPLORER_EDIT_ACTION,
    FILE_EXPLORER_PIN_ACTION,
    FILE_EXPLORER_RETURN_TO_HUBLOTS_ACTION,
    FILE_EXPLORER_SAVE_ACTION,
    FILE_EXPLORER_UPLOAD_ACTION,
  } from "../runtime/uiActionNames.js";

  const browserActions = getBrowserActions();
  const uiActions = getUiActionRegistry();
  const browseFileExplorer = (path) => uiActions.invoke(FILE_EXPLORER_BROWSE_ACTION, path);
  const editExploredFile = (path) => uiActions.invoke(FILE_EXPLORER_EDIT_ACTION, path);
  const saveFileExplorer = () => uiActions.invoke(FILE_EXPLORER_SAVE_ACTION);
  const uploadFileExplorer = () => uiActions.invoke(FILE_EXPLORER_UPLOAD_ACTION);
  const pinExploredPath = (path) => uiActions.invoke(FILE_EXPLORER_PIN_ACTION, path);
  const backFileExplorer = () => uiActions.invoke(FILE_EXPLORER_BACK_ACTION);
  const backFileExplorerToHublots = () => uiActions.invoke(FILE_EXPLORER_RETURN_TO_HUBLOTS_ACTION);

  function toggleHiddenFiles() {
    updateFileExplorer({ showHidden: !$fileExplorer.showHidden });
  }

  function retryFileExplorer() {
    browseFileExplorer($fileExplorer.path || undefined);
  }

  function submitFileEditor(event) {
    event.preventDefault();
    if (!$fileExplorer.saving) saveFileExplorer();
  }

  function updateEditorContent(event) {
    updateFileExplorer({ editContent: event.currentTarget.value });
  }

  function handleEditorKeydown(event) {
    if (
      event.isComposing
      || event.key !== "s"
      || (!event.metaKey && !event.ctrlKey)
      || $fileExplorer.saving
    ) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  let requestedFiles = DEFAULT_COLLECTION_PAGE_SIZE;
  let filePageIdentity = null;

  $: files = visibleBrowserEntries($fileExplorer.files, $fileExplorer.showHidden);
  $: directories = visibleBrowserEntries($fileExplorer.dirs, $fileExplorer.showHidden);
  $: nextFilePageIdentity = `${$fileExplorer.path}\0${$fileExplorer.showHidden}`;
  $: if (nextFilePageIdentity !== filePageIdentity) {
    filePageIdentity = nextFilePageIdentity;
    requestedFiles = DEFAULT_COLLECTION_PAGE_SIZE;
  }
  $: filePage = incrementalCollectionPage(files, requestedFiles);
  $: nextFilePageSize = Math.min(filePage.pageSize, filePage.remainingCount);
  $: folderIsEmpty = !directories.length && !files.length;
  $: hiddenFilesLabel = $fileExplorer.showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles";
  $: editedFileDownload = browserActions.fileDownload($fileExplorer.editPath);

  function revealFiles() {
    requestedFiles = nextCollectionPageCount(
      filePage.visibleCount,
      filePage.visibleCount + filePage.remainingCount,
      filePage.pageSize,
    );
  }
</script>

{#if $fileExplorer.loading}
  <div class="m-path" role="status"><span class="spin" aria-hidden="true"></span> loading files…</div>
{:else if $fileExplorer.error}
  <div class="m-path async-error" role="alert">
    <span>Could not load files: {$fileExplorer.error}</span>
    <button class="chip" type="button" onclick={retryFileExplorer}>Retry</button>
  </div>
{:else if $fileExplorer.mode === "edit"}
  <form id="fileEditorForm" aria-busy={$fileExplorer.saving} onsubmit={submitFileEditor}>
    <div class="m-path" title={$fileExplorer.editPath}>{$fileExplorer.editPath}</div>
    <textarea
      aria-label={`Edit ${$fileExplorer.editPath}`}
      value={$fileExplorer.editContent}
      spellcheck="false"
      class="modal-code-editor file-editor"
      aria-keyshortcuts="Control+S Meta+S"
      oninput={updateEditorContent}
      onkeydown={handleEditorKeydown}
    ></textarea>
    {#if $fileExplorer.saveError}<div class="m-path async-error" role="alert">{$fileExplorer.saveError} — correct the problem and retry Save.</div>{/if}
  </form>
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
    onPin={pinExploredPath}
  />
  {#if filePage.items.length}
    <div role="list" aria-label="Files">
      {#each filePage.items as file (file.name)}
        {@const fullPath = browserPathFor($fileExplorer.path, file)}
        {@const download = browserActions.fileDownload(fullPath)}
        <div class="file-explorer-row" role="listitem">
          <BrowserFileEntry {file} path={fullPath} expanded={true} onOpen={editExploredFile} />
          <a
            class="chip chip-link"
            href={download.href}
            download={download.filename}
            title={`download ${file.name}`}
            aria-label={`Download ${file.name}`}
          >⬇</a>
          <button type="button" class="chip" title={`pin ${file.name}`} aria-label={`Pin ${file.name}`} onclick={() => pinExploredPath(fullPath)}>⌖</button>
          <button type="button" class="chip" title={`edit ${file.name}`} aria-label={`Edit ${file.name}`} onclick={() => editExploredFile(fullPath)}>✎</button>
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

{#if $fileExplorer.mode === "list" && !$fileExplorer.loading && !$fileExplorer.error && $fileExplorer.uploadError}
  <div class="m-path async-error" role="alert">{$fileExplorer.uploadError} — choose the file again to retry.</div>
{/if}

<div class="m-actions" id="mActions">
  {#if $fileExplorer.mode === "edit"}
    <button class="chip" type="submit" form="fileEditorForm" disabled={$fileExplorer.saving}>{$fileExplorer.saving ? "Saving…" : "Save"}</button>
    <a class="chip chip-link" href={editedFileDownload.href} download={editedFileDownload.filename}>Download</a>
    <button class="chip" type="button" onclick={backFileExplorer}>← Back</button>
  {:else}
    <button class="chip" type="button" title={`upload local files to ${$fileExplorer.path}`} disabled={$fileExplorer.uploading} onclick={uploadFileExplorer}>
      {#if $fileExplorer.uploading}<span class="spin" aria-hidden="true">⟳</span>{/if}
      {$fileExplorer.uploadText}
    </button>
    <button class="chip" type="button" title={`pin ${$fileExplorer.path}`} onclick={() => pinExploredPath($fileExplorer.path)}>⌖ Pin folder</button>
    <button class="chip toggle-hidden" type="button" onclick={toggleHiddenFiles}>{hiddenFilesLabel}</button>
    <button class="chip" type="button" onclick={backFileExplorerToHublots}>← Widgets</button>
  {/if}
  <button class="chip" type="button" data-modal-cancel onclick={closeModalState}>Close</button>
</div>
