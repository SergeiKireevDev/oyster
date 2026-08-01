<script>
  import { scrollIntoViewWhen } from "../lib/modalDomAdapters.js";

  /** @typedef {{ before: string; match: string; after: string }} Highlight */

  const noop = () => {};

  /**
   * @type {{
   *   text?: unknown;
   *   index?: number;
   *   query?: string;
   *   modelMode?: boolean;
   *   active?: boolean;
   *   selected?: boolean;
   *   onChoose?: (index: number) => void;
   *   onActivate?: (index: number) => void;
   * }}
   */
  let {
    text = "",
    index = -1,
    query = "",
    modelMode = false,
    active = false,
    selected = false,
    onChoose = noop,
    onActivate = noop,
  } = $props();

  /**
   * @param {string} value
   * @param {string} searchQuery
   * @returns {Highlight}
   */
  function highlight(value, searchQuery) {
    const matchIndex = searchQuery ? value.toLowerCase().indexOf(searchQuery) : -1;
    return matchIndex < 0
      ? { before: value, match: "", after: "" }
      : {
          before: value.slice(0, matchIndex),
          match: value.slice(matchIndex, matchIndex + searchQuery.length),
          after: value.slice(matchIndex + searchQuery.length),
        };
  }

  function choose() {
    onChoose(index);
  }

  function activate() {
    onActivate(index);
  }

  let optionText = $derived(String(text));
  let normalizedQuery = $derived(String(query).trim().toLowerCase());
  let separator = $derived(optionText.indexOf("/"));
  let providerText = $derived(separator < 0 ? "custom" : optionText.slice(0, separator));
  let modelText = $derived(separator < 0 ? optionText : optionText.slice(separator + 1));
  let provider = $derived(highlight(providerText, normalizedQuery));
  let model = $derived(highlight(modelText, normalizedQuery));
  let modelOptionLabel = $derived(selected ? `${optionText}, current model` : optionText);
</script>

{#if modelMode}
  <button
    type="button"
    class="model-autocomplete-option"
    class:active
    class:selected
    data-option-index={index}
    role="option"
    aria-selected={selected}
    aria-label={modelOptionLabel}
    title={optionText}
    use:scrollIntoViewWhen={active}
    onclick={choose}
    onmouseenter={activate}
  >
    <span class="model-provider">{provider.before}{#if provider.match}<mark>{provider.match}</mark>{/if}{provider.after}</span>
    <span class="model-name">{model.before}{#if model.match}<mark>{model.match}</mark>{/if}{model.after}</span>
    <span class="model-option-status">
      {#if selected}<span class="model-selected-mark" aria-hidden="true">✓</span>{/if}
      {#if active}<span class="model-enter-hint" aria-hidden="true">↵</span>{/if}
    </span>
  </button>
{:else}
  <button
    type="button"
    class="m-option"
    class:active
    data-option-index={index}
    role="option"
    aria-selected={active}
    title={optionText}
    use:scrollIntoViewWhen={active}
    onclick={choose}
    onmouseenter={activate}
  >{optionText}</button>
{/if}

<style>
  .model-autocomplete-option {
    display: grid;
    grid-template-columns: minmax(72px, auto) minmax(0, 1fr) minmax(22px, auto);
    align-items: center;
    gap: 10px;
    min-height: 43px;
    padding: 7px 10px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color .15s, background-color .15s;
  }

  .model-autocomplete-option:hover,
  .model-autocomplete-option.active {
    border-color: var(--accent);
    background: var(--accent-dim);
  }

  .model-autocomplete-option.selected:not(.active) {
    background: color-mix(in srgb, var(--accent-dim) 48%, transparent);
  }

  .model-provider {
    max-width: 130px;
    overflow: hidden;
    color: var(--muted);
    font: 10px/1.3 var(--mono);
    letter-spacing: .055em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .model-name {
    min-width: 0;
    overflow: hidden;
    font-size: 13px;
    font-weight: 590;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model-autocomplete-option mark {
    padding: 0;
    border-radius: 2px;
    background: transparent;
    color: var(--accent);
    font-weight: 750;
  }

  .model-option-status {
    display: flex;
    min-width: 22px;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }

  .model-selected-mark {
    color: var(--accent);
    font-weight: 800;
    text-align: center;
  }

  .model-enter-hint {
    color: var(--muted);
    font: 11px var(--mono);
    text-align: center;
  }

  @media (max-width: 760px) {
    .model-autocomplete-option {
      grid-template-columns: minmax(62px, 28%) minmax(0, 1fr) minmax(18px, auto);
      min-height: 44px;
      padding-inline: 8px;
    }

    .model-provider { max-width: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .model-autocomplete-option { transition: none; }
  }
</style>
