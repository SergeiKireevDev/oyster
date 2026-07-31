<script>
  import { getCheckpointModelPicker } from "../runtime/checkpointModelPickerContext.js";

  const NO_SUMMARY_OPTION = Object.freeze({
    value: "",
    label: "💨 No summary — timestamp message",
  });
  const picker = getCheckpointModelPicker();
  const checkpointModelPicker = picker.state;

  function createOptions(models, selected) {
    const uniqueModels = [...new Set(models.filter((model) => typeof model === "string" && model))];
    if (selected && !uniqueModels.includes(selected)) uniqueModels.unshift(selected);
    return [NO_SUMMARY_OPTION, ...uniqueModels.map((model) => ({ value: model, label: model }))];
  }

  function setCheckpointModel(event) {
    picker.setSelected(event.currentTarget.value);
  }

  function cancelCheckpointModelPicker() {
    picker.cancel();
  }

  function submitCheckpointModelPicker(event) {
    event.preventDefault();
    picker.submit();
  }

  $: selected = $checkpointModelPicker.selected;
  $: options = createOptions($checkpointModelPicker.models, selected);
  $: hasHelp = Boolean($checkpointModelPicker.hint || $checkpointModelPicker.loading);
</script>

<form onsubmit={submitCheckpointModelPicker}>
  <div class="search-row">
    <label for="checkpointSummaryModel">Checkpoint summary model</label>
    <select
      id="checkpointSummaryModel"
      class="modal-flex-control"
      value={selected}
      aria-describedby={hasHelp ? "checkpointModelPickerHelp" : undefined}
      aria-busy={$checkpointModelPicker.loading}
      onchange={setCheckpointModel}
    >
      {#each options as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </div>
  {#if hasHelp}
    <div id="checkpointModelPickerHelp" class="m-path">
      {$checkpointModelPicker.hint}
      {#if $checkpointModelPicker.loading}
        <span role="status" aria-live="polite" aria-atomic="true">
          <span class="spin" aria-hidden="true">⟳</span>
          Loading models…
        </span>
      {/if}
    </div>
  {/if}
  <div class="m-actions">
    <button class="chip" type="button" data-modal-cancel onclick={cancelCheckpointModelPicker}>Cancel</button>
    <button class="btn modal-primary-action" type="submit">{$checkpointModelPicker.okLabel}</button>
  </div>
</form>
