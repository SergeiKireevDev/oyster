<script>
  import { renderSanitizedMarkdown } from "../lib/markdownRenderer.js";

  let { source = "", element = "div", className = "", label = undefined } = $props();
  const rendered = $derived(renderSanitizedMarkdown(String(source ?? "")));
</script>

<svelte:element this={element} class={className} aria-label={label}>
  {@html rendered}
</svelte:element>
