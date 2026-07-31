<script>
  import { highlightSearchSnippet } from "../lib/sessionSearchHighlight.js";

  /** @typedef {{ before?: unknown; match?: unknown; after?: unknown }} SearchSnippet */

  /** @type {{ role?: string; kind?: string; snippet?: SearchSnippet | null; query?: string; copyClass?: string }} */
  let { role, kind, snippet, query = "", copyClass } = $props();

  /** @param {string | undefined} value @param {string | undefined} fallback */
  function roleLabel(value, fallback) {
    if (value === "user") return "you";
    if (value === "assistant") return "ai";
    if (value === "toolResult") return "tool";
    return fallback;
  }

  /** @param {SearchSnippet | null | undefined} value @param {string} searchQuery */
  function keyedSearchSegments(value, searchQuery) {
    let offset = 0;
    return highlightSearchSnippet(value, searchQuery).map((segment) => {
      const key = `${offset}:${segment.match}`;
      offset += segment.text.length;
      return { ...segment, key };
    });
  }

  const label = $derived(roleLabel(role, kind));
  const segments = $derived(keyedSearchSegments(snippet, query));
</script>

<span class="s-role">{label}</span>{" "}<span class={copyClass}>
  {#each segments as segment (segment.key)}
    {#if segment.match}<mark>{segment.text}</mark>{:else}{segment.text}{/if}
  {/each}
</span>
