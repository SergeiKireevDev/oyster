<script>
  import { tick } from "svelte";
  import OptionPickerItem from "./OptionPickerItem.svelte";
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const optionPicker = dialogs.optionPicker;

  $: modelMode = $optionPicker.variant === "model";
  $: query = ($optionPicker.query || "").trim().toLowerCase();
  $: visible = $optionPicker.options
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => !query || String(text).toLowerCase().includes(query));

  function setActive(index) {
    if (index !== $optionPicker.active) dialogs.setOptionActive(index);
  }

  function move(dir) {
    if (!visible.length) return;
    const cur = visible.findIndex((item) => item.index === $optionPicker.active);
    const next = cur < 0 ? (dir > 0 ? 0 : visible.length - 1) : (cur + dir + visible.length) % visible.length;
    setActive(visible[next].index);
  }

  function onKey(event) {
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Enter") {
      event.preventDefault();
      const target = $optionPicker.active >= 0 && visible.some((item) => item.index === $optionPicker.active)
        ? $optionPicker.active
        : ($optionPicker.searchable ? visible[0]?.index : null);
      if (target != null) dialogs.chooseOption(target);
    } else if (event.key === "Escape") {
      event.preventDefault();
      dialogs.cancelOption();
    }
  }

  async function updateQuery(value) {
    dialogs.setOptionQuery(value);
    await tick();
    if (visible.length) setActive(visible[0].index);
  }
</script>

<svelte:document onkeydowncapture={onKey} />

{#if $optionPicker.searchable}
  <label class:model-autocomplete-search={modelMode} class="option-picker-search">
    {#if modelMode}<span aria-hidden="true">⌕</span>{/if}
    <input
      type="search"
      placeholder={$optionPicker.placeholder}
      value={$optionPicker.query}
      role="combobox"
      aria-label={$optionPicker.placeholder}
      aria-controls="optionPickerResults"
      aria-expanded="true"
      autocomplete="off"
      oninput={(event) => updateQuery(event.currentTarget.value)}
    />
    {#if modelMode && query}<kbd>{visible.length}</kbd>{/if}
  </label>
{/if}

<div
  id="optionPickerResults"
  class:model-autocomplete-results={modelMode}
  class="option-picker-results"
  role="listbox"
  aria-label={$optionPicker.title}
>
  {#if !visible.length}
    <div class="option-picker-empty" role="status">No matching {modelMode ? "models" : "options"}</div>
  {:else}
    {#each visible as item (item.index)}
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
  <button class="chip" data-modal-cancel onclick={dialogs.cancelOption}>Cancel</button>
</div>
