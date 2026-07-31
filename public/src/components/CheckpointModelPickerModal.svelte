<script>
  import { getCheckpointModelPicker } from "../runtime/checkpointModelPickerContext.js";

  const NO_SUMMARY_OPTION = Object.freeze({
    value: "",
    label: "No summary — timestamp message",
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

<form class="checkpoint-model-picker" aria-busy={$checkpointModelPicker.loading} onsubmit={submitCheckpointModelPicker}>
  <div class="checkpoint-model-field">
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
    <div id="checkpointModelPickerHelp" class="checkpoint-model-help">
      {#if $checkpointModelPicker.hint}
        <span class="checkpoint-model-hint">{$checkpointModelPicker.hint}</span>
      {/if}
      {#if $checkpointModelPicker.loading}
        <span class="checkpoint-model-loading" role="status" aria-live="polite" aria-atomic="true">
          <span class="spin" aria-hidden="true"></span>
          Loading models…
        </span>
      {/if}
    </div>
  {/if}
  <div class="m-actions" id="mActions">
    <button class="chip" type="button" data-modal-cancel onclick={cancelCheckpointModelPicker}>Cancel</button>
    <button class="btn modal-primary-action" type="submit">{$checkpointModelPicker.okLabel}</button>
  </div>
</form>

<style>
  .checkpoint-model-picker {
    display: grid;
    gap: 10px;
  }

  .checkpoint-model-field {
    display: grid;
    gap: 5px;
    min-width: 0;
  }

  .checkpoint-model-field label {
    color: var(--muted);
    font-size: 11.5px;
    font-weight: 620;
    letter-spacing: .01em;
  }

  .checkpoint-model-field select {
    width: 100%;
    min-width: 0;
    min-height: 40px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
    color: var(--text);
    font: 12px/1.4 var(--mono);
    cursor: pointer;
    transition: border-color .14s ease, background .14s ease;
  }

  .checkpoint-model-field select:hover {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    background: color-mix(in srgb, var(--accent) 4%, var(--panel));
  }

  .checkpoint-model-field select:focus-visible { border-color: var(--accent); }

  .checkpoint-model-help {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.45;
  }

  .checkpoint-model-hint {
    min-width: 0;
    flex: 1 1 240px;
    overflow-wrap: anywhere;
  }

  .checkpoint-model-loading {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    color: var(--accent);
    font-weight: 620;
    white-space: nowrap;
  }

  .checkpoint-model-loading .spin {
    width: 12px;
    height: 12px;
    border-top-color: currentColor;
  }

  @media (max-width: 600px) {
    .checkpoint-model-picker { gap: 8px; }
    .checkpoint-model-field select { min-height: 42px; }
  }
</style>
