<script>
  import { browserPathFor, visibleBrowserEntries } from "../lib/fileBrowser.js";
  import { incrementalCollectionPage, nextCollectionPageCount } from "../lib/incrementalCollection.js";

  export let path = "";
  export let home = "";
  export let workdir = "";
  export let parent = null;
  export let dirs = [];
  export let showHidden = true;
  export let showWorkdir = false;
  export let showPath = true;
  export let onBrowse = () => {};
  export let onPin = null;

  let requestedDirectories = 40;
  let directoryPageIdentity = null;

  $: visibleDirs = visibleBrowserEntries(dirs, showHidden);
  $: nextDirectoryPageIdentity = `${path}\0${showHidden}`;
  $: if (nextDirectoryPageIdentity !== directoryPageIdentity) {
    directoryPageIdentity = nextDirectoryPageIdentity;
    requestedDirectories = 40;
  }
  $: directoryPage = incrementalCollectionPage(visibleDirs, requestedDirectories);
  $: hasNavigation = path !== home || (showWorkdir && workdir && path !== workdir) || parent;

  function revealDirectories() {
    requestedDirectories = nextCollectionPageCount(
      directoryPage.visibleCount,
      directoryPage.visibleCount + directoryPage.remainingCount,
      directoryPage.pageSize,
    );
  }
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
{#each directoryPage.items as dir (dir.name)}
  {@const fullPath = browserPathFor(path, dir)}
  <div class="browser-directory-row">
    <button class={`m-option dir ${dir.hidden ? "hidden-entry" : ""}`} onclick={() => onBrowse(fullPath)}>{dir.name}</button>
    {#if onPin}<button type="button" class="chip" title={`pin ${dir.name}`} aria-label={`Pin ${dir.name}`} onclick={() => onPin(fullPath)}>⌖</button>{/if}
  </div>
{/each}
{#if directoryPage.remainingCount}
  <button type="button" class="collection-load-more" onclick={revealDirectories}>Show {Math.min(directoryPage.pageSize, directoryPage.remainingCount)} more folders</button>
{/if}
