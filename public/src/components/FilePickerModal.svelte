<script>
  import { browsePickedFileFolder, pickFile } from "../lib/legacyBridge.js";
  import { filePicker } from "../stores/filePicker.js";

  $: dirs = $filePicker.showHidden
    ? $filePicker.dirs
    : $filePicker.dirs.filter((dir) => !dir.hidden);
  $: files = $filePicker.showHidden
    ? $filePicker.files
    : $filePicker.files.filter((file) => !file.hidden);

  function pathFor(entry) {
    return `${String($filePicker.path).replace(/\/$/, "")}/${entry.name}`;
  }

  function fmtSize(n) {
    if (n == null) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

{#if $filePicker.loading}
  <div class="m-path"><span class="spin"></span> loading files…</div>
{:else}
  <div class="m-path">{$filePicker.path}</div>

  {#if $filePicker.path !== $filePicker.home}
    <button class="m-option dir homeDir" onclick={() => browsePickedFileFolder($filePicker.home)}>home</button>
  {/if}
  {#if $filePicker.workdir && $filePicker.path !== $filePicker.workdir}
    <button class="m-option dir" onclick={() => browsePickedFileFolder($filePicker.workdir)}>workdir</button>
  {/if}
  {#if $filePicker.parent}
    <button class="m-option dir up" onclick={() => browsePickedFileFolder($filePicker.parent)}>..</button>
  {/if}
  {#each dirs as dir (dir.name)}
    <button class={`m-option dir ${dir.hidden ? "hidden-entry" : ""}`} onclick={() => browsePickedFileFolder(pathFor(dir))}>{dir.name}</button>
  {/each}
  {#each files as file (file.name)}
    <button class={`m-option file ${file.hidden ? "hidden-entry" : ""}`.trim()} title={pathFor(file)} onclick={() => pickFile(pathFor(file))}>
      {file.name}<span class="f-size">{fmtSize(file.size)}</span>
    </button>
  {/each}
  {#if !dirs.length && !files.length}
    <div class="m-path">(empty folder)</div>
  {/if}
{/if}
