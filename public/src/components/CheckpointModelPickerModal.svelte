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

<form onsubmit={(event) => { event.preventDefault(); submitCheckpointModelPicker(); }}>
  <div class="search-row">
    <label for="checkpointSummaryModel">Checkpoint summary model</label>
    <select
      id="checkpointSummaryModel"
      class="modal-flex-control"
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
      <span role="status"><span class="spin" aria-hidden="true">⟳</span> Loading models…</span>
    {/if}
  </div>
  <div class="m-actions">
    <button class="chip" type="button" data-modal-cancel onclick={cancelCheckpointModelPicker}>Cancel</button>
    <button class="btn modal-primary-action" type="submit">{$checkpointModelPicker.okLabel}</button>
  </div>
</form>
