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
    queueMicrotask(() => node.focus());
  }

  $: visibleDirectories = visibleBrowserEntries($folderBrowser.dirs, $folderBrowser.showHidden);
  $: hasVisibleDirectories = visibleDirectories.length > 0;
</script>

{#if $folderBrowser.loading}
  <div class="m-path" role="status"><span class="spin"></span> loading folders…</div>
{:else if $folderBrowser.error}
  <div class="m-path async-error" role="alert">
    <span>Could not load folders: {$folderBrowser.error}</span>
    <button class="chip" type="button" onclick={() => browseFolderBrowser($folderBrowser.path || undefined)}>Retry</button>
  </div>
{:else}
  <div class="m-path">{$folderBrowser.path}</div>

  <div class="browser-list-actions" aria-label="Folder actions">
    <button class="chip" onclick={() => updateFolderBrowser({ createOpen: true, newName: "" })}>New folder</button>
    <button
      class="chip toggle-hidden"
      class:active={$folderBrowser.showHidden}
      aria-pressed={$folderBrowser.showHidden}
      onclick={() => updateFolderBrowser({ showHidden: !$folderBrowser.showHidden })}
    >👁 Dotfiles</button>
  </div>

  {#if $folderBrowser.createOpen}
    <form class="newdir-row" onsubmit={(event) => { event.preventDefault(); createFolderBrowser(); }}>
      <label for="newFolderName">New folder name</label>
      <input
        id="newFolderName"
        type="text"
        placeholder="new folder name"
        value={$folderBrowser.newName}
        oninput={(event) => updateFolderBrowser({ newName: event.currentTarget.value })}
        use:focusOnMount
        required
      />
      <button class="btn" type="submit" disabled={$folderBrowser.creating}>{$folderBrowser.creating ? "Creating…" : "Create"}</button>
    </form>
    {#if $folderBrowser.createError}<div class="m-path async-error" role="alert">{$folderBrowser.createError} — edit the name and try again.</div>{/if}
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
    <div class="m-path">(no subfolders)</div>
  {/if}
{/if}

<div class="m-actions" id="mActions">
  <button class="chip" data-modal-cancel onclick={cancelFolderBrowser}>Cancel</button>
  <button class="btn modal-primary-action" onclick={submitFolderBrowser}>Start session here</button>
</div>
