<script>
  import BrowserDirectoryList from "./BrowserDirectoryList.svelte";
  import {
    browseFolder,
    createFolder,
    hideFolderCreateRow,
    setFolderNewName,
  } from "../lib/legacyBridge.js";
  import { visibleBrowserEntries } from "../lib/fileBrowser.js";
  import { folderBrowser } from "../stores/folderBrowser.js";

  function focusOnMount(node) {
    queueMicrotask(() => node.focus());
  }
</script>

{#if $folderBrowser.loading}
  <div class="m-path"><span class="spin"></span> loading folders…</div>
{:else}
  <div class="m-path">{$folderBrowser.path}</div>

  {#if $folderBrowser.createOpen}
    <div class="newdir-row">
      <input
        type="text"
        placeholder="new folder name"
        value={$folderBrowser.newName}
        oninput={(event) => setFolderNewName(event.currentTarget.value)}
        onkeydown={(event) => {
          if (event.key === "Enter") createFolder();
          else if (event.key === "Escape") hideFolderCreateRow();
        }}
        use:focusOnMount
      />
      <button class="btn" disabled={$folderBrowser.creating} onclick={createFolder}>Create</button>
    </div>
  {/if}

  <BrowserDirectoryList
    path={$folderBrowser.path}
    home={$folderBrowser.home}
    parent={$folderBrowser.parent}
    dirs={$folderBrowser.dirs}
    showHidden={$folderBrowser.showHidden}
    showPath={false}
    onBrowse={browseFolder}
  />
  {#if !visibleBrowserEntries($folderBrowser.dirs, $folderBrowser.showHidden).length}
    <div class="m-path">(no subfolders)</div>
  {/if}
{/if}
