<script>
  import OptionPickerItem from "./OptionPickerItem.svelte";
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const optionPicker = dialogs.optionPicker;

  /** @typedef {{ text: unknown; index: number }} VisibleOption */

  /**
   * @param {unknown[]} options
   * @param {unknown} searchQuery
   * @returns {VisibleOption[]}
   */
  function filterOptions(options, searchQuery) {
    const normalizedQuery = String(searchQuery ?? "").trim().toLowerCase();
    return options
      .map((text, index) => ({ text, index }))
      .filter(({ text }) => !normalizedQuery || String(text).toLowerCase().includes(normalizedQuery));
  }

  /** @param {number} index */
  function setActive(index) {
    if (index !== $optionPicker.active) dialogs.setOptionActive(index);
  }

  /** @param {number} direction */
  function move(direction) {
    if (!visibleOptions.length) return;
    const currentPosition = visibleOptions.findIndex(({ index }) => index === $optionPicker.active);
    const nextPosition = currentPosition < 0
      ? (direction > 0 ? 0 : visibleOptions.length - 1)
      : (currentPosition + direction + visibleOptions.length) % visibleOptions.length;
    setActive(visibleOptions[nextPosition].index);
  }

  /** @param {KeyboardEvent} event */
  function handleKeydown(event) {
    if (event.isComposing) return;

    if (event.key === "Escape") {
      event.preventDefault();
      dialogs.cancelOption();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key !== "Enter" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    // Buttons already provide native Enter activation. Handling Enter here would
    // incorrectly choose the active option when the Cancel button has focus.
    if (event.target instanceof Element && event.target.closest("button")) return;

    const activeIndex = $optionPicker.active;
    const targetIndex = activeIndex >= 0 && visibleOptions.some(({ index }) => index === activeIndex)
      ? activeIndex
      : ($optionPicker.searchable ? visibleOptions[0]?.index : undefined);
    if (targetIndex === undefined) return;

    event.preventDefault();
    dialogs.chooseOption(targetIndex);
  }

  /** @param {InputEvent & { currentTarget: HTMLInputElement }} event */
  function updateQuery(event) {
    const nextQuery = event.currentTarget.value;
    dialogs.setOptionQuery(nextQuery);
    const [firstMatch] = filterOptions($optionPicker.options, nextQuery);
    if (firstMatch) setActive(firstMatch.index);
  }

  let modelMode = $derived($optionPicker.variant === "model");
  let query = $derived(String($optionPicker.query ?? "").trim().toLowerCase());
  let visibleOptions = $derived(filterOptions($optionPicker.options, query));
  let searchLabel = $derived($optionPicker.placeholder || `Search ${$optionPicker.title || "options"}`);
</script>

<svelte:document onkeydowncapture={handleKeydown} />

{#if $optionPicker.searchable}
  <label class:model-autocomplete-search={modelMode} class="option-picker-search">
    {#if modelMode}<span class="model-search-icon" aria-hidden="true">⌕</span>{/if}
    <input
      type="search"
      placeholder={$optionPicker.placeholder}
      value={$optionPicker.query}
      role="combobox"
      aria-label={searchLabel}
      aria-controls="optionPickerResults"
      aria-expanded="true"
      aria-autocomplete="list"
      autocomplete="off"
      oninput={updateQuery}
    />
    {#if modelMode && query}
      <span class="model-result-count" aria-label={`${visibleOptions.length} matching models`}>{visibleOptions.length}</span>
    {/if}
  </label>
{/if}

<div
  id="optionPickerResults"
  class:model-autocomplete-results={modelMode}
  class="option-picker-results"
  role="listbox"
  aria-label={$optionPicker.title}
>
  {#if !visibleOptions.length}
    <div class="option-picker-empty" role="status" aria-atomic="true">No matching {modelMode ? "models" : "options"}</div>
  {:else}
    {#each visibleOptions as item (item.index)}
      <OptionPickerItem
        text={item.text}
        index={item.index}
        {query}
        {modelMode}
        active={item.index === $optionPicker.active}
        selected={item.index === $optionPicker.selected}
        onChoose={dialogs.chooseOption}
        onActivate={setActive}
      />
    {/each}
  {/if}
</div>

<div class="m-actions" id="mActions">
  {#if modelMode}<span class="model-picker-help">↑↓ navigate · enter select</span>{/if}
  <button class="chip" type="button" data-modal-cancel onclick={dialogs.cancelOption}>Cancel</button>
</div>

<style>
  .option-picker-search {
    display: block;
    min-width: 0;
    margin-bottom: 10px;
  }

  .option-picker-search input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    min-height: 40px;
    padding: 8px 11px;
    border: 1px solid var(--border);
    border-radius: 10px;
    outline: 0;
    background: var(--panel);
    color: var(--text);
    font: inherit;
    transition: border-color .15s ease, background-color .15s ease, box-shadow .15s ease;
  }

  .option-picker-search input:hover {
    border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
    background: color-mix(in srgb, var(--accent) 4%, var(--panel));
  }

  .option-picker-search input:focus-visible {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-dim);
  }

  .option-picker-search.model-autocomplete-search {
    position: relative;
    display: flex;
    min-height: 44px;
    align-items: center;
    gap: 9px;
    margin-bottom: 10px;
    padding: 0 11px;
    border: 1px solid var(--border);
    border-radius: 11px;
    background: var(--panel-2);
    color: var(--muted);
    transition: border-color .15s ease, background-color .15s ease, box-shadow .15s ease;
  }

  .option-picker-search.model-autocomplete-search:hover {
    border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
    background: color-mix(in srgb, var(--accent) 3%, var(--panel-2));
  }

  .option-picker-search.model-autocomplete-search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-dim);
  }

  .model-search-icon {
    flex: none;
    font-size: 18px;
    line-height: 1;
    transform: rotate(-15deg);
  }

  .model-autocomplete-search input {
    min-height: 0;
    flex: 1;
    padding: 0;
    border: 0;
    border-radius: 0;
    outline: 0;
    background: transparent;
    box-shadow: none;
    font-size: 14px;
  }

  .model-autocomplete-search input:hover,
  .model-autocomplete-search input:focus-visible {
    border: 0;
    background: transparent;
    box-shadow: none;
  }

  .model-result-count {
    min-width: 22px;
    flex: none;
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--panel);
    color: var(--muted);
    font: 10px/1.4 var(--mono);
    text-align: center;
  }

  .option-picker-results {
    min-width: 0;
  }

  .option-picker-results.model-autocomplete-results {
    display: flex;
    max-height: min(52vh, 430px);
    flex-direction: column;
    gap: 5px;
    padding: 2px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }

  .option-picker-empty {
    min-width: 0;
    padding: 26px 14px;
    border: 1px dashed color-mix(in srgb, var(--border) 82%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel) 52%, transparent);
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    text-align: center;
  }

  .model-picker-help {
    min-width: 0;
    margin-right: auto;
    color: var(--muted);
    font: 10px/1.4 var(--mono);
  }

  @media (max-width: 760px) {
    .option-picker-search input { min-height: 44px; }
    .model-autocomplete-search input { min-height: 0; }
    .model-picker-help { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .option-picker-search,
    .option-picker-search input { transition: none; }
  }
</style>
