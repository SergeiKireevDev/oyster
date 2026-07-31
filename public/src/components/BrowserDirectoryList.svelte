<script>
  import { browserPathFor, visibleBrowserEntries } from "../lib/fileBrowser.js";
  import {
    DEFAULT_COLLECTION_PAGE_SIZE,
    incrementalCollectionPage,
    nextCollectionPageCount,
  } from "../lib/incrementalCollection.js";

  /** @typedef {{ name: string; hidden?: boolean }} BrowserDirectory */

  /**
   * @type {{
   *   path?: string;
   *   home?: string;
   *   workdir?: string;
   *   parent?: string | null;
   *   dirs?: BrowserDirectory[];
   *   showHidden?: boolean;
   *   showWorkdir?: boolean;
   *   showPath?: boolean;
   *   onBrowse?: (path: string) => void;
   *   onPin?: ((path: string) => void) | null;
   * }}
   */
  let {
    path = "",
    home = "",
    workdir = "",
    parent = null,
    dirs = [],
    showHidden = true,
    showWorkdir = false,
    showPath = true,
    onBrowse = () => {},
    onPin = null,
  } = $props();

  let requestedDirectories = $state(DEFAULT_COLLECTION_PAGE_SIZE);
  let directoryPageIdentity = $state(null);

  let visibleDirectories = $derived(visibleBrowserEntries(dirs, showHidden));
  let nextDirectoryPageIdentity = $derived(`${path}\0${showHidden}`);

  $effect.pre(() => {
    if (nextDirectoryPageIdentity === directoryPageIdentity) return;

    directoryPageIdentity = nextDirectoryPageIdentity;
    requestedDirectories = DEFAULT_COLLECTION_PAGE_SIZE;
  });

  let directoryPage = $derived(incrementalCollectionPage(visibleDirectories, requestedDirectories));
  let hasNavigation = $derived(Boolean(
    path !== home || (showWorkdir && workdir && path !== workdir) || parent,
  ));
  let nextPageSize = $derived(Math.min(directoryPage.pageSize, directoryPage.remainingCount));

  function revealDirectories() {
    requestedDirectories = nextCollectionPageCount(
      directoryPage.visibleCount,
      directoryPage.visibleCount + directoryPage.remainingCount,
      directoryPage.pageSize,
    );
  }
</script>

{#if showPath}
  <div class="m-path" title={path}>{path}</div>
{/if}

{#if hasNavigation}
  <nav class="browser-directory-navigation" aria-label="Directory shortcuts">
    {#if path !== home}
      <button type="button" class="m-option dir homeDir" title={home} onclick={() => onBrowse(home)}>home</button>
    {/if}
    {#if showWorkdir && workdir && path !== workdir}
      <button type="button" class="m-option dir" title={workdir} onclick={() => onBrowse(workdir)}>workdir</button>
    {/if}
    {#if parent}
      <button type="button" class="m-option dir up" title={parent} aria-label="Parent folder" onclick={() => onBrowse(parent)}>..</button>
    {/if}
  </nav>
{/if}

{#if hasNavigation && visibleDirectories.length}
  <div class="browser-directory-separator" role="separator" aria-label="Folders"></div>
{/if}

{#if directoryPage.items.length}
  <div class="browser-directory-list" role="list" aria-label="Folders">
    {#each directoryPage.items as dir (dir.name)}
      {@const fullPath = browserPathFor(path, dir)}
      <div class="browser-directory-row" role="listitem">
        <button
          type="button"
          class="m-option dir"
          class:hidden-entry={dir.hidden}
          title={fullPath}
          onclick={() => onBrowse(fullPath)}
        >{dir.name}</button>
        {#if onPin}
          <button
            type="button"
            class="chip"
            title={`Pin ${dir.name}`}
            aria-label={`Pin ${dir.name}`}
            onclick={() => onPin(fullPath)}
          ><span aria-hidden="true">⌖</span></button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if directoryPage.remainingCount}
  <button type="button" class="collection-load-more" onclick={revealDirectories}>
    Show {nextPageSize} more folders
  </button>
{/if}
