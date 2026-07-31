<script>
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
  {file.name}{#if formattedSize}<span class="f-size">{formattedSize}</span>{/if}
</button>

<style>
  .file {
    overflow-wrap: anywhere;
  }

  .browser-file-expanded {
    flex: 1;
    min-width: 0;
  }
</style>
