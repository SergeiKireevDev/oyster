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
    title={optionText}
    use:scrollIntoViewWhen={active}
    onclick={choose}
    onmouseenter={activate}
  >
    <span class="model-provider">{provider.before}{#if provider.match}<mark>{provider.match}</mark>{/if}{provider.after}</span>
    <span class="model-name">{model.before}{#if model.match}<mark>{model.match}</mark>{/if}{model.after}</span>
    {#if selected}<span class="model-selected-mark" aria-label="Current model">✓</span>{/if}
    {#if active}<span class="model-enter-hint" aria-hidden="true">↵</span>{/if}
  </button>
{:else}
  <button
    type="button"
    class="m-option"
    class:active
    data-option-index={index}
    role="option"
    aria-selected={active}
    use:scrollIntoViewWhen={active}
    onclick={choose}
    onmouseenter={activate}
  >{optionText}</button>
{/if}
