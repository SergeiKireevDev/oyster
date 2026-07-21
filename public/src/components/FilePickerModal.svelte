<script>
  import BrowserDirectoryList from "./BrowserDirectoryList.svelte";
  import { browserPathFor, fmtFileSize, visibleBrowserEntries } from "../lib/fileBrowser.js";
  import { filePicker, updateFilePicker } from "../stores/filePicker.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    FILE_PICKER_BROWSE_ACTION,
    FILE_PICKER_CANCEL_ACTION,
    FILE_PICKER_CHOOSE_ACTION,
    FILE_PICKER_USE_FOLDER_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const browseFilePicker = (path) => uiActions.invoke(FILE_PICKER_BROWSE_ACTION, path);
  const pickFilePicker = (path) => uiActions.invoke(FILE_PICKER_CHOOSE_ACTION, path);
  const useFilePickerFolder = () => uiActions.invoke(FILE_PICKER_USE_FOLDER_ACTION);
  const cancelFilePicker = () => uiActions.invoke(FILE_PICKER_CANCEL_ACTION);

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
  <button class="chip" title="Insert the current folder path" onclick={useFilePickerFolder}>📁 Use this folder</button>
  <button class="chip toggle-hidden" onclick={() => updateFilePicker({ showHidden: !$filePicker.showHidden })}>{$filePicker.showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles"}</button>
  <button class="chip" onclick={cancelFilePicker}>Cancel</button>
</div>
