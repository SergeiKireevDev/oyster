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
  $: hiddenFoldersLabel = $folderBrowser.showHidden ? "Hide dotfiles" : "Show dotfiles";
  $: canSubmitFolder = !$folderBrowser.loading && !$folderBrowser.error && !$folderBrowser.creating;
</script>

{#if $folderBrowser.loading}
  <div class="m-path" role="status"><span class="spin" aria-hidden="true"></span> loading folders…</div>
{:else if $folderBrowser.error}
  <div class="m-path async-error" role="alert">
    <span>Could not load folders: {$folderBrowser.error}</span>
    <button class="chip" type="button" onclick={retryFolderBrowser}>Retry</button>
  </div>
{:else}
  <div class="m-path" title={$folderBrowser.path}>{$folderBrowser.path}</div>

  <div class="browser-list-actions" aria-label="Folder actions">
    <button class="chip" type="button" onclick={openCreateFolderForm}>New folder</button>
    <button
      class="chip toggle-hidden"
      class:active={$folderBrowser.showHidden}
      type="button"
      aria-pressed={$folderBrowser.showHidden}
      onclick={toggleHiddenFolders}
    ><span aria-hidden="true">👁️</span> {hiddenFoldersLabel}</button>
  </div>

  {#if $folderBrowser.createOpen}
    <form class="newdir-row" aria-busy={$folderBrowser.creating} onsubmit={submitCreateFolder}>
      <label for="newFolderName">New folder name</label>
      <input
        id="newFolderName"
        type="text"
        placeholder="new folder name"
        value={$folderBrowser.newName}
        aria-invalid={$folderBrowser.createError ? "true" : undefined}
        aria-describedby={$folderBrowser.createError ? "newFolderError" : undefined}
        disabled={$folderBrowser.creating}
        oninput={updateNewFolderName}
        use:focusOnMount
        required
      />
      <button class="btn" type="submit" disabled={$folderBrowser.creating}>{$folderBrowser.creating ? "Creating…" : "Create"}</button>
    </form>
    {#if $folderBrowser.createError}
      <div id="newFolderError" class="m-path async-error" role="alert">{$folderBrowser.createError} — edit the name and try again.</div>
    {/if}
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
    <div class="m-path" role="status">(no subfolders)</div>
  {/if}
{/if}

<div class="m-actions" id="mActions">
  <button class="chip" type="button" data-modal-cancel onclick={cancelFolderBrowser}>Cancel</button>
  <button class="btn modal-primary-action" type="button" disabled={!canSubmitFolder} onclick={submitFolderBrowser}>Start session here</button>
</div>
