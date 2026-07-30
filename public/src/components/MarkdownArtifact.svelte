<script>
  import SanitizedMarkdown from "./SanitizedMarkdown.svelte";

  export let source = "";
  export let label = "Markdown artifact";
</script>

<SanitizedMarkdown element="article" className="pinned-markdown-viewer" {source} {label} />
