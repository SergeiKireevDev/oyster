<script>
  import {
    browseExploredFolder,
    editExploredFile,
    saveExploredFile,
    setExploredFileContent,
  } from "../lib/legacyBridge.js";
  import { fileExplorer } from "../stores/fileExplorer.js";

  $: dirs = $fileExplorer.showHidden
    ? $fileExplorer.dirs
    : $fileExplorer.dirs.filter((dir) => !dir.hidden);
  $: files = $fileExplorer.showHidden
    ? $fileExplorer.files
    : $fileExplorer.files.filter((file) => !file.hidden);

  function pathFor(entry) {
    return `${String($fileExplorer.path).replace(/\/$/, "")}/${entry.name}`;
  }

  function fmtSize(n) {
    if (n == null) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

{#if $fileExplorer.loading}
  <div class="m-path"><span class="spin"></span> loading files…</div>
{:else if $fileExplorer.mode === "edit"}
  <div class="m-path">{$fileExplorer.editPath}</div>
  <textarea
    value={$fileExplorer.editContent}
    spellcheck="false"
    style="width:100%;height:50vh;resize:vertical;font:12.5px/1.5 ui-monospace,monospace;white-space:pre;tab-size:4;box-sizing:border-box;margin-top:6px;"
    oninput={(event) => setExploredFileContent(event.currentTarget.value)}
    onkeydown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        saveExploredFile();
      }
    }}
  ></textarea>
{:else}
  <div class="m-path">{$fileExplorer.path}</div>

  {#if $fileExplorer.path !== $fileExplorer.home}
    <button class="m-option dir homeDir" onclick={() => browseExploredFolder($fileExplorer.home)}>home</button>
  {/if}
  {#if $fileExplorer.workdir && $fileExplorer.path !== $fileExplorer.workdir}
    <button class="m-option dir" onclick={() => browseExploredFolder($fileExplorer.workdir)}>workdir</button>
  {/if}
  {#if $fileExplorer.parent}
    <button class="m-option dir up" onclick={() => browseExploredFolder($fileExplorer.parent)}>..</button>
  {/if}
  {#each dirs as dir (dir.name)}
    <button class={`m-option dir ${dir.hidden ? "hidden-entry" : ""}`} onclick={() => browseExploredFolder(pathFor(dir))}>{dir.name}</button>
  {/each}
  {#each files as file (file.name)}
    <div style="display:flex;align-items:center;gap:6px;">
      <button class={`m-option file ${file.hidden ? "hidden-entry" : ""}`.trim()} style="flex:1;min-width:0;" title={pathFor(file)} onclick={() => editExploredFile(pathFor(file))}>
        {file.name}<span class="f-size">{fmtSize(file.size)}</span>
      </button>
      <a
        class="chip"
        href={`/file-download?token=${encodeURIComponent($fileExplorer.token)}&path=${encodeURIComponent(pathFor(file))}`}
        download={file.name}
        title={`download ${file.name}`}
        style="text-decoration:none"
      >⬇</a>
      <span class="chip" role="button" tabindex="0" title={`edit ${file.name}`} onclick={() => editExploredFile(pathFor(file))} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") editExploredFile(pathFor(file)); }}>✎</span>
    </div>
  {/each}
  {#if !dirs.length && !files.length}
    <div class="m-path">(empty folder)</div>
  {/if}
{/if}
