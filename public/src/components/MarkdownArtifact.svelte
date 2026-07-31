<script>
  import SanitizedMarkdown from "./SanitizedMarkdown.svelte";

  /** @type {{ source?: string; label?: string }} */
  let { source = "", label = "Markdown artifact" } = $props();

  const hasContent = $derived(source.trim().length > 0);
</script>

{#if hasContent}
  <SanitizedMarkdown element="article" className="pinned-markdown-viewer" {source} {label} />
{:else}
  <div class="artifact-state" role="status" aria-atomic="true">This Markdown artifact is empty.</div>
{/if}
