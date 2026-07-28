<script>
  import { onMount, tick } from "svelte";
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const optionPicker = dialogs.optionPicker;

  let searchEl;
  let listEl;

  $: modelMode = $optionPicker.variant === "model";
  $: query = ($optionPicker.query || "").trim().toLowerCase();
  $: visible = $optionPicker.options
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => !query || String(text).toLowerCase().includes(query));

  function splitModel(value) {
    const text = String(value);
    const separator = text.indexOf("/");
    return separator < 0
      ? { provider: "custom", name: text }
      : { provider: text.slice(0, separator), name: text.slice(separator + 1) };
  }

  function highlight(value) {
    const text = String(value);
    const index = query ? text.toLowerCase().indexOf(query) : -1;
    return index < 0
      ? { before: text, match: "", after: "" }
      : { before: text.slice(0, index), match: text.slice(index, index + query.length), after: text.slice(index + query.length) };
  }

  async function setActive(index) {
    dialogs.setOptionActive(index);
    await tick();
    listEl?.querySelector(`[data-option-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
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

  onMount(() => {
    tick().then(() => {
      searchEl?.focus();
      if ($optionPicker.active >= 0) setActive($optionPicker.active);
    });
  });
</script>

<svelte:document onkeydowncapture={onKey} />

{#if $optionPicker.searchable}
  <label class:model-autocomplete-search={modelMode} class="option-picker-search">
    {#if modelMode}<span aria-hidden="true">⌕</span>{/if}
    <input
      bind:this={searchEl}
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
  bind:this={listEl}
  id="optionPickerResults"
  class:model-autocomplete-results={modelMode}
  class="option-picker-results"
  role="listbox"
  aria-label={$optionPicker.title}
>
  {#if !visible.length}
    <div class="option-picker-empty">No matching {modelMode ? "models" : "options"}</div>
  {:else if modelMode}
    {#each visible as item (item.index)}
      {@const model = splitModel(item.text)}
      {@const provider = highlight(model.provider)}
      {@const name = highlight(model.name)}
      <button
        class="model-autocomplete-option"
        class:active={item.index === $optionPicker.active}
        class:selected={item.index === $optionPicker.selected}
        data-option-index={item.index}
        role="option"
        aria-selected={item.index === $optionPicker.selected}
        onclick={() => dialogs.chooseOption(item.index)}
        onmousemove={() => setActive(item.index)}
      >
        <span class="model-provider">{provider.before}{#if provider.match}<mark>{provider.match}</mark>{/if}{provider.after}</span>
        <span class="model-name">{name.before}{#if name.match}<mark>{name.match}</mark>{/if}{name.after}</span>
        {#if item.index === $optionPicker.selected}<span class="model-selected-mark" aria-label="Current model">✓</span>{/if}
        {#if item.index === $optionPicker.active}<span class="model-enter-hint" aria-hidden="true">↵</span>{/if}
      </button>
    {/each}
  {:else}
    {#each visible as item (item.index)}
      <button
        class="m-option"
        class:active={item.index === $optionPicker.active}
        data-option-index={item.index}
        role="option"
        aria-selected={item.index === $optionPicker.active}
        onclick={() => dialogs.chooseOption(item.index)}
        onmousemove={() => setActive(item.index)}
      >{item.text}</button>
    {/each}
  {/if}
</div>

<div class="m-actions" id="mActions">
  {#if modelMode}<span class="model-picker-help">↑↓ navigate · enter select</span>{/if}
  <button class="chip" data-modal-cancel onclick={dialogs.cancelOption}>Cancel</button>
</div>
