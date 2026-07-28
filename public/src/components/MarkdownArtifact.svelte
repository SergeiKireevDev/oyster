<script>
  import { renderMarkdown } from "../lib/markdownRenderer.js";

  export let source = "";
  export let label = "Markdown artifact";

  $: rendered = renderMarkdown(String(source ?? ""));
</script>

<article class="pinned-markdown-viewer" aria-label={label}>
  {@html rendered}
</article>
