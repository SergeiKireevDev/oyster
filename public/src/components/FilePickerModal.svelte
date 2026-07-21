<script>
  import BrowserDirectoryList from "./BrowserDirectoryList.svelte";
  import { browsePickedFileFolder, pickFile } from "../lib/legacyBridge.js";
  import { browserPathFor, fmtFileSize, visibleBrowserEntries } from "../lib/fileBrowser.js";
  import { filePicker } from "../stores/filePicker.js";

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
    onBrowse={browsePickedFileFolder}
  />
  {#each files as file (file.name)}
    {@const fullPath = browserPathFor($filePicker.path, file)}
    <button class={`m-option file ${file.hidden ? "hidden-entry" : ""}`.trim()} title={fullPath} onclick={() => pickFile(fullPath)}>
      {file.name}<span class="f-size">{fmtFileSize(file.size)}</span>
    </button>
  {/each}
  {#if !visibleBrowserEntries($filePicker.dirs, $filePicker.showHidden).length && !files.length}
    <div class="m-path">(empty folder)</div>
  {/if}
{/if}
