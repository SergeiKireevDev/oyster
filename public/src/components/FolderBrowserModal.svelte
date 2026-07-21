<script>
  import {
    browseFolder,
    createFolder,
    hideFolderCreateRow,
    setFolderNewName,
  } from "../lib/legacyBridge.js";
  import { folderBrowser } from "../stores/folderBrowser.js";

  $: dirs = $folderBrowser.showHidden
    ? $folderBrowser.dirs
    : $folderBrowser.dirs.filter((dir) => !dir.hidden);

  function pathFor(dir) {
    return `${String($folderBrowser.path).replace(/\/$/, "")}/${dir.name}`;
  }

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

  {#if $folderBrowser.path !== $folderBrowser.home}
    <button class="m-option dir homeDir" onclick={() => browseFolder($folderBrowser.home)}>home</button>
  {/if}
  {#if $folderBrowser.parent}
    <button class="m-option dir up" onclick={() => browseFolder($folderBrowser.parent)}>..</button>
  {/if}
  {#each dirs as dir (dir.name)}
    <button class={`m-option dir ${dir.hidden ? "hidden-entry" : ""}`} onclick={() => browseFolder(pathFor(dir))}>{dir.name}</button>
  {/each}
  {#if !$folderBrowser.dirs.length}
    <div class="m-path">(no subfolders)</div>
  {/if}
{/if}
