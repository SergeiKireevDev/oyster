<script>
  import BrowserDirectoryList from "./BrowserDirectoryList.svelte";
  import {
    browseFolder,
  } from "../lib/legacyBridge.js";
  import { visibleBrowserEntries } from "../lib/fileBrowser.js";
  import { folderBrowser, updateFolderBrowser } from "../stores/folderBrowser.js";

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
        oninput={(event) => updateFolderBrowser({ newName: event.currentTarget.value })}
        onkeydown={(event) => {
          if (event.key === "Enter") window.dispatchEvent(new Event("pi-folder-browser-create"));
          else if (event.key === "Escape") updateFolderBrowser({ createOpen: false, newName: "" });
        }}
        use:focusOnMount
      />
      <button class="btn" disabled={$folderBrowser.creating} onclick={() => window.dispatchEvent(new Event("pi-folder-browser-create"))}>Create</button>
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
