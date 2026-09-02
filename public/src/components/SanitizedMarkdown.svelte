<script>
  import { extractMermaidDiagrams, renderSanitizedMarkdown } from "../lib/markdownRenderer.js";
  import { createMermaidResultsStore } from "../lib/mermaidRenderer.js";

  /** @typedef {"article" | "div"} RootElement */
  /** @typedef {{ source?: string; element?: RootElement; className?: string; label?: string; enableMermaid?: boolean; onMermaidExplore?: (diagram: { index: number; source: string }) => void }} Props */

  /** @type {Props} */
  let { source = "", element = "div", className = "", label, enableMermaid = false, onMermaidExplore } = $props();

  /** @param {unknown} value */
  function optionalTrimmedString(value) {
    if (typeof value !== "string") return undefined;
    return value.trim() || undefined;
  }

  // Keep the generated tag constrained even when untyped callers provide an
  // unsupported value at runtime. Empty optional attributes are omitted.
  const rootElement = $derived(element === "article" ? "article" : "div");
  const callerClass = $derived(optionalTrimmedString(className));
  const rootClass = $derived(callerClass ? `sanitized-markdown ${callerClass}` : "sanitized-markdown");
  const accessibleLabel = $derived(optionalTrimmedString(label));
  const mermaidSources = $derived(enableMermaid ? extractMermaidDiagrams(source) : []);
  const mermaidResultsStore = $derived(createMermaidResultsStore(mermaidSources));
  const renderedHtml = $derived(renderSanitizedMarkdown(source, {
    enableMermaid,
    mermaidResults: $mermaidResultsStore,
    showMermaidExplore: typeof onMermaidExplore === "function",
  }));

  /** @param {MouseEvent} event */
  function handleRootClick(event) {
    const action = event.target?.closest?.(".mermaid-explore-action");
    if (!action || typeof onMermaidExplore !== "function") return;
    const index = Number.parseInt(action.getAttribute("data-mermaid-index") ?? "", 10);
    if (!Number.isInteger(index) || index < 0 || index >= mermaidSources.length) return;
    onMermaidExplore({ index, source: mermaidSources[index] });
  }
</script>

<svelte:element
  this={rootElement}
  class={rootClass}
  role={typeof onMermaidExplore === "function" ? "region" : undefined}
  aria-label={accessibleLabel}
  onclick={handleRootClick}
>
  <!-- Runtime Markdown, KaTeX, and strict-mode Mermaid produce variable nested
       structures that cannot be expressed as static Svelte markup. This is the sole
       injection boundary; renderSanitizedMarkdown normalizes and escapes source input
       before generating its allowlisted markup. Never pass caller-provided HTML to this component. -->
  {@html renderedHtml}
</svelte:element>
