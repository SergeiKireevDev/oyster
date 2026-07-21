<script>
  import { onMount, tick } from "svelte";
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const optionPicker = dialogs.optionPicker;

  let searchEl;

  $: query = ($optionPicker.query || "").trim().toLowerCase();
  $: visible = $optionPicker.options
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => !query || String(text).toLowerCase().includes(query));

  function move(dir) {
    if (!visible.length) return;
    const cur = visible.findIndex((item) => item.index === $optionPicker.active);
    const next = cur < 0 ? (dir > 0 ? 0 : visible.length - 1) : (cur + dir + visible.length) % visible.length;
    dialogs.setOptionActive(visible[next].index);
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

  onMount(() => {
    tick().then(() => searchEl?.focus());
  });
</script>

<svelte:document onkeydowncapture={onKey} />

{#if $optionPicker.searchable}
  <input
    bind:this={searchEl}
    type="text"
    placeholder="Filter…"
    value={$optionPicker.query}
    oninput={(event) => dialogs.setOptionQuery(event.currentTarget.value)}
  />
{/if}

{#each visible as item (item.index)}
  <button
    class="m-option"
    class:active={item.index === $optionPicker.active}
    onclick={() => dialogs.chooseOption(item.index)}
    onmousemove={() => dialogs.setOptionActive(item.index)}
  >{item.text}</button>
{/each}

<div class="m-actions" id="mActions">
  <button class="chip" onclick={dialogs.cancelOption}>Cancel</button>
</div>
