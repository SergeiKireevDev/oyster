<script>
  import FolderIcon from "./FolderIcon.svelte";
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
      <button type="button" class="m-option dir browser-directory-shortcut" title={home} onclick={() => onBrowse(home)}>Home</button>
    {/if}
    {#if showWorkdir && workdir && path !== workdir}
      <button type="button" class="m-option dir browser-directory-shortcut" title={workdir} onclick={() => onBrowse(workdir)}>Workdir</button>
    {/if}
    {#if parent}
      <button type="button" class="m-option dir browser-directory-shortcut" title={parent} aria-label="Parent folder" onclick={() => onBrowse(parent)}>Parent</button>
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
          class="m-option dir browser-directory-button"
          class:hidden-entry={dir.hidden}
          title={fullPath}
          onclick={() => onBrowse(fullPath)}
        >
          <FolderIcon size={15} />
          <span class="browser-directory-name">{dir.name}</span>
        </button>
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

<style>
  .browser-directory-navigation {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
    gap: 5px;
  }

  .browser-directory-separator {
    height: 1px;
    margin: 10px 2px;
    background: var(--border);
  }

  .browser-directory-list {
    display: grid;
    gap: 5px;
    min-width: 0;
  }

  .browser-directory-row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
  }

  .browser-directory-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .browser-directory-row > .chip {
    width: 32px;
    min-width: 32px;
    min-height: 32px;
    padding: 0;
  }

  @media (max-width: 760px) {
    .browser-directory-navigation { grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); }

    .browser-directory-row > .chip {
      width: var(--icon-control-standard);
      min-width: var(--icon-control-standard);
      min-height: var(--icon-control-standard);
    }
  }

  @media (max-width: 520px) {
    .browser-directory-navigation { grid-template-columns: 1fr; }
  }
</style>
