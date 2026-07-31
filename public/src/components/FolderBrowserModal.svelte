<script>
  import BrowserDirectoryList from "./BrowserDirectoryList.svelte";
  import { visibleBrowserEntries } from "../lib/fileBrowser.js";
  import { folderBrowser, updateFolderBrowser } from "../stores/folderBrowser.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    FOLDER_BROWSER_BROWSE_ACTION,
    FOLDER_BROWSER_CANCEL_ACTION,
    FOLDER_BROWSER_CREATE_ACTION,
    FOLDER_BROWSER_SUBMIT_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const browseFolderBrowser = (path) => uiActions.invoke(FOLDER_BROWSER_BROWSE_ACTION, path);
  const createFolderBrowser = () => uiActions.invoke(FOLDER_BROWSER_CREATE_ACTION);
  const submitFolderBrowser = () => uiActions.invoke(FOLDER_BROWSER_SUBMIT_ACTION);
  const cancelFolderBrowser = () => uiActions.invoke(FOLDER_BROWSER_CANCEL_ACTION);

  function focusOnMount(node) {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted && node.isConnected) node.focus();
    });

    return {
      destroy() {
        mounted = false;
      },
    };
  }

  function openCreateFolderForm() {
    updateFolderBrowser({ createOpen: true, newName: "", createError: "" });
  }

  function toggleHiddenFolders() {
    updateFolderBrowser({ showHidden: !$folderBrowser.showHidden });
  }

  function updateNewFolderName(event) {
    updateFolderBrowser({ newName: event.currentTarget.value });
  }

  function submitCreateFolder(event) {
    event.preventDefault();
    if (!$folderBrowser.creating) createFolderBrowser();
  }

  function retryFolderBrowser() {
    browseFolderBrowser($folderBrowser.path || undefined);
  }

  $: visibleDirectories = visibleBrowserEntries($folderBrowser.dirs, $folderBrowser.showHidden);
  $: hasVisibleDirectories = visibleDirectories.length > 0;
  $: hiddenFoldersLabel = $folderBrowser.showHidden ? "Hide hidden folders" : "Show hidden folders";
  $: canSubmitFolder = !$folderBrowser.loading && !$folderBrowser.error && !$folderBrowser.creating;
</script>

{#if $folderBrowser.loading}
  <div class="folder-browser-state" role="status" aria-live="polite" aria-atomic="true">
    <span class="spin" aria-hidden="true"></span>
    <span>Loading folders…</span>
  </div>
{:else if $folderBrowser.error}
  <div class="folder-browser-state folder-browser-error async-error" role="alert" aria-atomic="true">
    <span>Could not load folders: {$folderBrowser.error}</span>
    <button class="chip" type="button" onclick={retryFolderBrowser}>Retry</button>
  </div>
{:else}
  <div class="folder-browser">
    <div class="m-path folder-browser-path" title={$folderBrowser.path}>{$folderBrowser.path}</div>

    <div class="browser-list-actions" aria-label="Folder actions">
      <button class="chip" type="button" disabled={$folderBrowser.creating} onclick={openCreateFolderForm}>New folder</button>
      <button
        class="chip toggle-hidden"
        class:active={$folderBrowser.showHidden}
        type="button"
        aria-pressed={$folderBrowser.showHidden}
        disabled={$folderBrowser.creating}
        onclick={toggleHiddenFolders}
      >{hiddenFoldersLabel}</button>
    </div>

    {#if $folderBrowser.createOpen}
      <form class="newdir-row" aria-busy={$folderBrowser.creating} onsubmit={submitCreateFolder}>
        <label for="newFolderName">New folder name</label>
        <div class="newdir-controls">
          <input
            id="newFolderName"
            type="text"
            placeholder="Folder name"
            value={$folderBrowser.newName}
            aria-invalid={$folderBrowser.createError ? "true" : undefined}
            aria-describedby={$folderBrowser.createError ? "newFolderError" : undefined}
            disabled={$folderBrowser.creating}
            oninput={updateNewFolderName}
            use:focusOnMount
            required
          />
          <button class="btn" type="submit" disabled={$folderBrowser.creating}>{$folderBrowser.creating ? "Creating…" : "Create"}</button>
        </div>
        {#if $folderBrowser.createError}
          <div id="newFolderError" class="newdir-error async-error" role="alert">{$folderBrowser.createError} — edit the name and try again.</div>
        {/if}
      </form>
    {/if}

    <BrowserDirectoryList
      path={$folderBrowser.path}
      home={$folderBrowser.home}
      parent={$folderBrowser.parent}
      dirs={$folderBrowser.dirs}
      showHidden={$folderBrowser.showHidden}
      showPath={false}
      onBrowse={browseFolderBrowser}
    />
    {#if !hasVisibleDirectories}
      <div class="folder-browser-empty" role="status">No subfolders here.</div>
    {/if}
  </div>
{/if}

<div class="m-actions" id="mActions">
  <button class="chip" type="button" data-modal-cancel onclick={cancelFolderBrowser}>Cancel</button>
  <button class="btn modal-primary-action start-session-action" type="button" disabled={!canSubmitFolder} onclick={submitFolderBrowser}>Start session here</button>
</div>

<style>
  .folder-browser {
    display: grid;
    min-width: 0;
    gap: 5px;
  }

  .folder-browser-path {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .folder-browser-state,
  .folder-browser-empty,
  .newdir-error {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .folder-browser-state {
    display: flex;
    min-height: 80px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-align: center;
  }

  .folder-browser-error {
    flex-wrap: wrap;
    color: var(--red);
  }

  .browser-list-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 5px;
  }

  .toggle-hidden.active {
    border-color: var(--accent);
    background: var(--accent-dim);
    color: var(--text);
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .newdir-row {
    display: grid;
    gap: 6px;
    margin-bottom: 5px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel-2) 52%, transparent);
  }

  .newdir-row > label {
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 620;
  }

  .newdir-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .newdir-controls input {
    min-width: 0;
    font-family: var(--mono);
  }

  .newdir-error {
    color: var(--red);
    overflow-wrap: anywhere;
  }

  .folder-browser-empty {
    padding: 22px 12px;
    border: 1px dashed var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel-2) 42%, transparent);
    text-align: center;
  }

  @media (max-width: 760px) {
    .browser-list-actions > button,
    .m-actions > button { min-height: 40px; }
  }

  @media (max-width: 520px) {
    .browser-list-actions,
    .newdir-controls { grid-template-columns: 1fr; }

    .browser-list-actions { display: grid; }
    .newdir-controls > .btn { width: 100%; }
    .m-actions > button { flex: 1 1 132px; }
    .m-actions > .start-session-action { order: -1; flex-basis: 100%; }
  }
</style>
