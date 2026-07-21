<script>
  import BrowserDirectoryList from "./BrowserDirectoryList.svelte";
  import { updateFileExplorer } from "../stores/fileExplorer.js";
  import { downloadFileUrl } from "../lib/fileBrowserActions.js";
  import { browserPathFor, fmtFileSize, visibleBrowserEntries } from "../lib/fileBrowser.js";
  import { fileExplorer } from "../stores/fileExplorer.js";

  const editExploredFile = (path) => window.dispatchEvent(new CustomEvent("pi-file-explorer-edit", { detail: path }));
  const saveExploredFile = () => window.dispatchEvent(new Event("pi-file-explorer-save"));

  $: files = visibleBrowserEntries($fileExplorer.files, $fileExplorer.showHidden);
</script>

{#if $fileExplorer.loading}
  <div class="m-path"><span class="spin"></span> loading files…</div>
{:else if $fileExplorer.mode === "edit"}
  <div class="m-path">{$fileExplorer.editPath}</div>
  <textarea
    value={$fileExplorer.editContent}
    spellcheck="false"
    style="width:100%;height:50vh;resize:vertical;font:12.5px/1.5 ui-monospace,monospace;white-space:pre;tab-size:4;box-sizing:border-box;margin-top:6px;"
    oninput={(event) => updateFileExplorer({ editContent: event.currentTarget.value })}
    onkeydown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        saveExploredFile();
      }
    }}
  ></textarea>
{:else}
  <BrowserDirectoryList
    path={$fileExplorer.path}
    home={$fileExplorer.home}
    workdir={$fileExplorer.workdir}
    parent={$fileExplorer.parent}
    dirs={$fileExplorer.dirs}
    showHidden={$fileExplorer.showHidden}
    showWorkdir={true}
    onBrowse={(path) => window.dispatchEvent(new CustomEvent("pi-file-explorer-browse", { detail: path }))}
  />
  {#each files as file (file.name)}
    {@const fullPath = browserPathFor($fileExplorer.path, file)}
    <div style="display:flex;align-items:center;gap:6px;">
      <button class={`m-option file ${file.hidden ? "hidden-entry" : ""}`.trim()} style="flex:1;min-width:0;" title={fullPath} onclick={() => editExploredFile(fullPath)}>
        {file.name}<span class="f-size">{fmtFileSize(file.size)}</span>
      </button>
      <a
        class="chip"
        href={downloadFileUrl($fileExplorer.token, fullPath)}
        download={file.name}
        title={`download ${file.name}`}
        style="text-decoration:none"
      >⬇</a>
      <span class="chip" role="button" tabindex="0" title={`edit ${file.name}`} onclick={() => editExploredFile(fullPath)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") editExploredFile(fullPath); }}>✎</span>
    </div>
  {/each}
  {#if !visibleBrowserEntries($fileExplorer.dirs, $fileExplorer.showHidden).length && !files.length}
    <div class="m-path">(empty folder)</div>
  {/if}
{/if}
