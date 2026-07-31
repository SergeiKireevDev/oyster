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
    {#if modelMode}<span aria-hidden="true">⌕</span>{/if}
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
    {#if modelMode && query}<kbd>{visibleOptions.length}</kbd>{/if}
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
    <div class="option-picker-empty" role="status">No matching {modelMode ? "models" : "options"}</div>
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
