<script>
  import SanitizedMarkdown from "./SanitizedMarkdown.svelte";

  /** @type {{ source?: string; label?: string }} */
  let { source = "", label = "Markdown artifact" } = $props();

  const hasRenderableContent = $derived(source.trim().length > 0);
</script>

<section class="markdown-artifact">
  {#if hasRenderableContent}
    <SanitizedMarkdown element="article" className="pinned-markdown-viewer" {source} {label} />
  {:else}
    <p class="artifact-state artifact-state-empty" role="status" aria-atomic="true">
      <span>This Markdown artifact is empty.</span>
    </p>
  {/if}
</section>

<style>
  .markdown-artifact {
    display: grid;
    width: 100%;
    min-width: 0;
    min-height: 100%;
  }
</style>
