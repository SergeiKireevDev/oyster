<script>
  import { browserPathFor, visibleBrowserEntries } from "../lib/fileBrowser.js";

  export let path = "";
  export let home = "";
  export let workdir = "";
  export let parent = null;
  export let dirs = [];
  export let showHidden = true;
  export let showWorkdir = false;
  export let showPath = true;
  export let onBrowse = () => {};

  $: visibleDirs = visibleBrowserEntries(dirs, showHidden);
  $: hasNavigation = path !== home || (showWorkdir && workdir && path !== workdir) || parent;
</script>

{#if showPath}
  <div class="m-path">{path}</div>
{/if}

{#if path !== home}
  <button class="m-option dir homeDir" onclick={() => onBrowse(home)}>home</button>
{/if}
{#if showWorkdir && workdir && path !== workdir}
  <button class="m-option dir" onclick={() => onBrowse(workdir)}>workdir</button>
{/if}
{#if parent}
  <button class="m-option dir up" onclick={() => onBrowse(parent)}>..</button>
{/if}
{#if hasNavigation && visibleDirs.length}
  <div class="browser-directory-separator" role="separator" aria-label="Folders"></div>
{/if}
{#each visibleDirs as dir (dir.name)}
  <button class={`m-option dir ${dir.hidden ? "hidden-entry" : ""}`} onclick={() => onBrowse(browserPathFor(path, dir))}>{dir.name}</button>
{/each}
