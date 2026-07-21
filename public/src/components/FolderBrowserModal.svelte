<script>
  import BrowserDirectoryList from "./BrowserDirectoryList.svelte";
  import { visibleBrowserEntries } from "../lib/fileBrowser.js";
  import { folderBrowser, updateFolderBrowser } from "../stores/folderBrowser.js";
  import { browseFolderBrowser, cancelFolderBrowser, createFolderBrowser, submitFolderBrowser } from "../features/files/folderBrowserActions.js";

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
          if (event.key === "Enter") createFolderBrowser();
          else if (event.key === "Escape") updateFolderBrowser({ createOpen: false, newName: "" });
        }}
        use:focusOnMount
      />
      <button class="btn" disabled={$folderBrowser.creating} onclick={createFolderBrowser}>Create</button>
    </div>
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
  {#if !visibleBrowserEntries($folderBrowser.dirs, $folderBrowser.showHidden).length}
    <div class="m-path">(no subfolders)</div>
  {/if}
{/if}

<div class="m-actions" id="mActions">
  <button class="chip" onclick={() => updateFolderBrowser({ createOpen: true, newName: "" })}>New folder</button>
  <button class="chip toggle-hidden" onclick={() => updateFolderBrowser({ showHidden: !$folderBrowser.showHidden })}>{$folderBrowser.showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles"}</button>
  <button class="chip" onclick={cancelFolderBrowser}>Cancel</button>
  <button class="btn" style="padding:6px 16px;" onclick={submitFolderBrowser}>Start session here</button>
</div>
