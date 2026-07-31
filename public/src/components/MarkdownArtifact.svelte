<script>
  import SanitizedMarkdown from "./SanitizedMarkdown.svelte";

  /** @type {{ source?: string; label?: string }} */
  let { source = "", label = "Markdown artifact" } = $props();

  const hasRenderableContent = $derived(source.trim().length > 0);
</script>

{#if hasRenderableContent}
  <SanitizedMarkdown element="article" className="pinned-markdown-viewer" {source} {label} />
{:else}
  <p class="empty-state" role="status" aria-atomic="true">This Markdown artifact is empty.</p>
{/if}

<style>
  .empty-state {
    box-sizing: border-box;
    display: grid;
    min-height: 100%;
    margin: 0;
    padding: 2rem;
    place-items: center;
    color: var(--muted);
    text-align: center;
  }
</style>
