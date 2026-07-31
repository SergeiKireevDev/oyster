<script>
  import { fmtFileSize } from "../lib/fileBrowser.js";

  export let file;
  export let path = "";
  export let expanded = false;
  export let onOpen = () => {};
</script>

<button
  class="m-option file"
  class:hidden-entry={file.hidden}
  class:browser-file-expanded={expanded}
  title={path}
  onclick={() => onOpen(path)}
>
  {file.name}<span class="f-size">{fmtFileSize(file.size)}</span>
</button>

<style>
  .browser-file-expanded {
    flex: 1;
    min-width: 0;
  }
</style>
