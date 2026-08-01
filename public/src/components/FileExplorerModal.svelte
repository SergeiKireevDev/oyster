<script>
  import AppIcon from "./AppIcon.svelte";
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
  $: hiddenFilesLabel = $fileExplorer.showHidden ? "Hide hidden files" : "Show hidden files";
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
  <div class="file-explorer-state" role="status">
    <span class="spin" aria-hidden="true"></span>
    <span>Loading files…</span>
  </div>
{:else if $fileExplorer.error}
  <div class="file-explorer-state file-explorer-error async-error" role="alert">
    <span>Could not load files: {$fileExplorer.error}</span>
    <button class="chip" type="button" onclick={retryFileExplorer}>Retry</button>
  </div>
{:else if $fileExplorer.mode === "edit"}
  <form id="fileEditorForm" class="file-editor-form" aria-busy={$fileExplorer.saving} onsubmit={submitFileEditor}>
    <div class="m-path file-editor-path" title={$fileExplorer.editPath}>{$fileExplorer.editPath}</div>
    <label class="file-editor-field">
      <span>File contents</span>
      <textarea
        aria-label={`Edit ${$fileExplorer.editPath}`}
        aria-describedby="fileEditorHint"
        value={$fileExplorer.editContent}
        spellcheck="false"
        class="modal-code-editor file-editor"
        aria-keyshortcuts="Control+S Meta+S"
        oninput={updateEditorContent}
        onkeydown={handleEditorKeydown}
      ></textarea>
    </label>
    <p class="file-editor-hint" id="fileEditorHint"><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd> to save</p>
    {#if $fileExplorer.saveError}<div class="file-editor-error async-error" role="alert">{$fileExplorer.saveError} — correct the problem and retry Save.</div>{/if}
  </form>
{:else}
  <div class="file-explorer-list">
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
    <div role="list" aria-label="Files" class="file-explorer-files">
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
          ><AppIcon name="download" size={15} /></a>
          <button type="button" class="chip" title={`pin ${file.name}`} aria-label={`Pin ${file.name}`} onclick={() => pinExploredPath(fullPath)}><span aria-hidden="true">⌖</span></button>
          <button type="button" class="chip" title={`edit ${file.name}`} aria-label={`Edit ${file.name}`} onclick={() => editExploredFile(fullPath)}><span aria-hidden="true">✎</span></button>
        </div>
      {/each}
    </div>
  {/if}
  {#if filePage.remainingCount}
    <button type="button" class="collection-load-more" onclick={revealFiles}>Show {nextFilePageSize} more files</button>
  {/if}
  {#if folderIsEmpty}
    <div class="file-explorer-empty" role="status">This folder is empty.</div>
  {/if}
  </div>
{/if}

{#if $fileExplorer.mode === "list" && !$fileExplorer.loading && !$fileExplorer.error && $fileExplorer.uploadError}
  <div class="m-path async-error" role="alert">{$fileExplorer.uploadError} — choose the file again to retry.</div>
{/if}

<div class="m-actions" id="mActions">
  {#if $fileExplorer.mode === "edit"}
    <button class="btn modal-primary-action" type="submit" form="fileEditorForm" disabled={$fileExplorer.saving}>{$fileExplorer.saving ? "Saving…" : "Save"}</button>
    <a class="chip chip-link" href={editedFileDownload.href} download={editedFileDownload.filename}>Download</a>
    <button class="chip" type="button" onclick={backFileExplorer}>← Back</button>
  {:else}
    <button class="chip" type="button" title={`upload local files to ${$fileExplorer.path}`} disabled={$fileExplorer.uploading} onclick={uploadFileExplorer}>
      {#if $fileExplorer.uploading}<span class="spin" aria-hidden="true">⟳</span>{/if}
      {$fileExplorer.uploadText}
    </button>
    <button class="chip toggle-hidden" class:active={$fileExplorer.showHidden} type="button" aria-pressed={$fileExplorer.showHidden} onclick={toggleHiddenFiles}>{hiddenFilesLabel}</button>
  {/if}
  <button class="chip" type="button" data-modal-cancel onclick={closeModalState}>Close</button>
</div>

<style>
  .file-explorer-list,
  .file-editor-form,
  .file-editor-field {
    display: grid;
    min-width: 0;
  }

  .file-explorer-list { gap: 5px; }
  .file-editor-form { gap: 7px; }
  .file-editor-field { gap: 5px; }

  .file-explorer-files {
    display: grid;
    gap: 5px;
    min-width: 0;
  }

  .file-explorer-row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
  }

  .file-explorer-row > .chip {
    display: inline-flex;
    width: 32px;
    min-width: 32px;
    min-height: 32px;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .file-explorer-state,
  .file-explorer-empty,
  .file-editor-error {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .file-explorer-state {
    display: flex;
    min-height: 80px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-align: center;
  }

  .file-explorer-error {
    flex-wrap: wrap;
    color: var(--red);
  }

  .file-explorer-empty {
    padding: 22px 12px;
    border: 1px dashed var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel-2) 42%, transparent);
    text-align: center;
  }

  .file-editor-path {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .file-editor-field > span,
  .file-editor-hint {
    color: var(--muted);
    font-size: 10.5px;
  }

  .file-editor-field > span { font-weight: 620; }

  .file-editor-form .file-editor {
    height: clamp(260px, 50vh, 560px);
    min-height: 180px;
    max-height: 58vh;
    margin: 0;
    overflow: auto;
    overflow-wrap: normal;
  }

  .file-editor-hint {
    margin: 0;
    line-height: 1.45;
    text-align: right;
  }

  .file-editor-hint kbd {
    padding: 1px 4px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--panel-2);
    color: var(--text);
    font: 9.5px/1.4 var(--mono);
  }

  .file-editor-error {
    color: var(--red);
  }

  .toggle-hidden.active {
    border-color: var(--selection-border);
    background: var(--selection-bg);
    color: var(--selection-text);
    box-shadow: inset 0 -1px 0 var(--selection-marker);
  }

  @media (max-width: 760px) {
    .file-explorer-row > .chip {
      width: var(--icon-control-standard);
      min-width: var(--icon-control-standard);
      min-height: var(--icon-control-standard);
    }

    .file-editor-form .file-editor { height: clamp(220px, 44vh, 420px); }
    .m-actions > :is(button, a) { min-height: 40px; }
  }

  @media (max-width: 520px) {
    .file-explorer-row { gap: 5px; }
    .file-explorer-row > .chip { width: var(--icon-control-standard); min-width: var(--icon-control-standard); }
    .file-editor-hint { text-align: left; }
    .m-actions > :is(button, a) { flex: 1 1 118px; }
  }
</style>
