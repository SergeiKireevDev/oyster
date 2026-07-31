<script>
  import { renderSanitizedMarkdown } from "../lib/markdownRenderer.js";

  /** @type {{ source?: string; element?: "article" | "div"; className?: string; label?: string }} */
  let { source = "", element = "div", className = "", label } = $props();

  const rootElement = $derived(element === "article" ? "article" : "div");
  const accessibleLabel = $derived(label?.trim() || undefined);
  const rendered = $derived(renderSanitizedMarkdown(source));
</script>

<svelte:element this={rootElement} class={className} aria-label={accessibleLabel}>
  <!-- Runtime Markdown and KaTeX produce variable nested structures that cannot be
       expressed as static Svelte markup. This is the sole injection boundary;
       renderSanitizedMarkdown normalizes and escapes source input before generating
       its allowlisted markup. Never pass caller-provided HTML to this component. -->
  {@html rendered}
</svelte:element>
