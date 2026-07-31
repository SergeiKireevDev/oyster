<script>
  import AppIcon from "./AppIcon.svelte";
  import { fmtFileSize } from "../lib/fileBrowser.js";

  /** @typedef {{ name: string; size?: number | null; hidden?: boolean }} BrowserFile */

  /**
   * @type {{
   *   file: BrowserFile;
   *   path: string;
   *   expanded?: boolean;
   *   onOpen: (path: string) => void;
   * }}
   */
  let {
    file,
    path,
    expanded = false,
    onOpen,
  } = $props();

  let formattedSize = $derived(fmtFileSize(file.size));

  function openFile() {
    onOpen(path);
  }
</script>

<button
  type="button"
  class="m-option file"
  class:hidden-entry={file.hidden}
  class:browser-file-expanded={expanded}
  title={path}
  aria-label={file.name}
  onclick={openFile}
>
  <span class="browser-file-content">
    <span class="browser-file-icon"><AppIcon name="file" size={15} /></span>
    <span class="browser-file-name">{file.name}</span>
    {#if formattedSize}<span class="f-size">{formattedSize}</span>{/if}
  </span>
</button>

<style>
  .file {
    min-width: 0;
    overflow: hidden;
  }

  .browser-file-content {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  .browser-file-icon {
    display: inline-flex;
    flex: none;
    color: var(--muted);
  }

  .browser-file-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .f-size {
    flex: none;
    margin-left: auto;
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .browser-file-expanded {
    flex: 1;
    min-width: 0;
    margin-bottom: 0;
  }

  @media (max-width: 760px) {
    .file { min-height: 40px; }
  }
</style>
