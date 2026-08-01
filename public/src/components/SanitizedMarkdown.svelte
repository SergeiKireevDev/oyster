<script>
  import { renderSanitizedMarkdown } from "../lib/markdownRenderer.js";

  /** @typedef {"article" | "div"} RootElement */
  /** @typedef {{ source?: string; element?: RootElement; className?: string; label?: string }} Props */

  /** @type {Props} */
  let { source = "", element = "div", className = "", label } = $props();

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
  const renderedHtml = $derived(renderSanitizedMarkdown(source));
</script>

<svelte:element this={rootElement} class={rootClass} aria-label={accessibleLabel}>
  <!-- Runtime Markdown and KaTeX produce variable nested structures that cannot be
       expressed as static Svelte markup. This is the sole injection boundary;
       renderSanitizedMarkdown normalizes and escapes source input before generating
       its allowlisted markup. Never pass caller-provided HTML to this component. -->
  {@html renderedHtml}
</svelte:element>
