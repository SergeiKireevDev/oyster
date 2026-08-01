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

<span class="search-hit-snippet">
  <span class="s-role">{label}</span>
  <span class={`search-hit-snippet-copy${copyClass ? ` ${copyClass}` : ""}`}>
    {#each segments as segment (segment.key)}
      {#if segment.match}<mark>{segment.text}</mark>{:else}{segment.text}{/if}
    {/each}
  </span>
</span>

<style>
  .search-hit-snippet {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    width: 100%;
    min-width: 0;
    color: var(--muted);
    font: inherit;
    line-height: inherit;
  }

  .s-role {
    flex: none;
    min-width: 28px;
    margin-top: 1px;
    padding: 1px 5px;
    border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-dim) 36%, transparent);
    color: var(--accent);
    font-size: 9px;
    font-weight: 700;
    line-height: 1.35;
    letter-spacing: .06em;
    text-align: center;
    text-transform: uppercase;
  }

  .search-hit-snippet-copy {
    display: -webkit-box;
    min-width: 0;
    overflow: hidden;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--search-hit-lines, 2);
  }

  mark {
    padding: 0 2px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--yellow) 28%, transparent);
    color: var(--text);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
</style>
