<script>
  import BrowserDirectoryList from "./BrowserDirectoryList.svelte";
  import { browserPathFor, fmtFileSize, visibleBrowserEntries } from "../lib/fileBrowser.js";
  import { filePicker, updateFilePicker } from "../stores/filePicker.js";
  import { browseFilePicker, cancelFilePicker, pickFilePicker, useFilePickerFolder } from "../features/files/filePickerActions.js";

  $: files = visibleBrowserEntries($filePicker.files, $filePicker.showHidden);
</script>

{#if $filePicker.loading}
  <div class="m-path"><span class="spin"></span> loading files…</div>
{:else}
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
  {#each files as file (file.name)}
    {@const fullPath = browserPathFor($filePicker.path, file)}
    <button class={`m-option file ${file.hidden ? "hidden-entry" : ""}`.trim()} title={fullPath} onclick={() => pickFilePicker(fullPath)}>
      {file.name}<span class="f-size">{fmtFileSize(file.size)}</span>
    </button>
  {/each}
  {#if !visibleBrowserEntries($filePicker.dirs, $filePicker.showHidden).length && !files.length}
    <div class="m-path">(empty folder)</div>
  {/if}
{/if}

<div class="m-actions" id="mActions">
  <span class="chip" role="button" tabindex="0" title="Insert the current folder path" onclick={useFilePickerFolder} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") useFilePickerFolder(); }}>📁 Use this folder</span>
  <span class="chip toggle-hidden" role="button" tabindex="0" onclick={() => updateFilePicker({ showHidden: !$filePicker.showHidden })} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") updateFilePicker({ showHidden: !$filePicker.showHidden }); }}>{$filePicker.showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles"}</span>
  <span class="chip" role="button" tabindex="0" onclick={cancelFilePicker} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") cancelFilePicker(); }}>Cancel</span>
</div>
