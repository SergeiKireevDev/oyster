<script>
  import { getCheckpointModelPicker } from "../runtime/checkpointModelPickerContext.js";

  const picker = getCheckpointModelPicker();
  const checkpointModelPicker = picker.state;
  const setCheckpointModel = (value) => picker.setSelected(value);
  const cancelCheckpointModelPicker = () => picker.cancel();
  const submitCheckpointModelPicker = () => picker.submit();

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
<div class="m-actions">
  <button class="chip" onclick={cancelCheckpointModelPicker}>Cancel</button>
  <button class="btn" style="padding:6px 16px;" onclick={submitCheckpointModelPicker}>{$checkpointModelPicker.okLabel}</button>
</div>
