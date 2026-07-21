<script>
  import {
    checkpointModelPicker,
    setCheckpointModel,
  } from "../stores/checkpointModelPicker.js";

  $: selected = $checkpointModelPicker.selected;
  $: options = [
    { value: "", label: "💨 No summary — timestamp message" },
    ...$checkpointModelPicker.models.map((model) => ({ value: model, label: model })),
  ];
</script>

<div class="search-row">
  <select
    style="flex:1;max-width:100%;"
    value={selected}
    onchange={(event) => setCheckpointModel(event.currentTarget.value)}
  >
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
</div>
<div class="m-path">
  {$checkpointModelPicker.hint}
  {#if $checkpointModelPicker.loading}
    <span class="spin" title="loading models">⟳</span>
  {/if}
</div>
