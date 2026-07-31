<script>
  import { renderSanitizedMarkdown } from "../lib/markdownRenderer.js";

  let { source = "", element = "div", className = "", label = undefined } = $props();
  const rendered = $derived(renderSanitizedMarkdown(source));
</script>

<svelte:element this={element} class={className} aria-label={label}>
  <!-- Runtime Markdown and KaTeX produce variable nested structures that cannot be
       expressed as static Svelte markup. This is the sole injection boundary;
       renderSanitizedMarkdown normalizes and escapes source input before generating
       its allowlisted markup. Never pass caller-provided HTML to this component. -->
  {@html rendered}
</svelte:element>
