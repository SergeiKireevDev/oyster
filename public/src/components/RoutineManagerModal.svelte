<script>
  import { routineManager, updateRoutineManager } from "../stores/routineManager.js";
  import { closeModalState } from "../stores/modal.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { ROUTINE_GENERATE_ACTION } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();

  function updateBrief(event) {
    updateRoutineManager({ brief: event.currentTarget.value });
  }

  function submitRoutine(event) {
    event.preventDefault();
    const brief = $routineManager.brief.trim();
    if ($routineManager.creating || !brief) return;
    uiActions.invoke(ROUTINE_GENERATE_ACTION, brief);
  }
</script>

<form aria-busy={$routineManager.creating} onsubmit={submitRoutine}>
  <div class="routine-generator">
    <label for="routineBrief" class="m-path">
      Describe a repeatable job. A background agent will write and register a run/teardown script for this session.
    </label>
    <textarea
      id="routineBrief"
      rows="6"
      placeholder="e.g. Rebuild the documentation site, report build progress, and remove generated files during teardown"
      value={$routineManager.brief}
      disabled={$routineManager.creating}
      oninput={updateBrief}
      required
    ></textarea>
  </div>

  <div class="m-actions" id="mActions">
    <button
      class="chip"
      type="button"
      data-modal-cancel
      disabled={$routineManager.creating}
      onclick={closeModalState}
    >Cancel</button>
    <button class="btn" type="submit" disabled={$routineManager.creating || !$routineManager.brief.trim()}>
      {#if $routineManager.creating}
        <span class="spin" aria-hidden="true"></span>
        <span role="status" aria-atomic="true">Building routine…</span>
      {:else}
        Build routine
      {/if}
    </button>
  </div>
</form>
