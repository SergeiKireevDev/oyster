<script>
  import SanitizedMarkdown from "./SanitizedMarkdown.svelte";

  export let source = "";
  export let label = "Markdown artifact";
</script>

{#if source.trim()}
  <SanitizedMarkdown element="article" className="pinned-markdown-viewer" {source} {label} />
{:else}
  <div class="artifact-state">This Markdown artifact is empty.</div>
{/if}
