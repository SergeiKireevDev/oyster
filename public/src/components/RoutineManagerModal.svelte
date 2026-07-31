<script>
  import { routineManager, updateRoutineManager } from "../stores/routineManager.js";
  import { closeModalState } from "../stores/modal.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { ROUTINE_GENERATE_ACTION } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const generateRoutine = () => uiActions.invoke(ROUTINE_GENERATE_ACTION, $routineManager.brief);
</script>

<form onsubmit={(event) => { event.preventDefault(); generateRoutine(); }}>
  <div class="routine-generator">
    <label for="routineBrief" class="m-path">Describe a repeatable job. A background agent will write and register a run/teardown script for this session.</label>
    <textarea
      id="routineBrief"
      rows="6"
      placeholder="e.g. Rebuild the documentation site, report build progress, and remove generated files during teardown"
      value={$routineManager.brief}
      oninput={(event) => updateRoutineManager({ brief: event.currentTarget.value })}
      required
    ></textarea>
  </div>

  <div class="m-actions" id="mActions">
    <button class="chip" type="button" data-modal-cancel disabled={$routineManager.creating} onclick={closeModalState}>Cancel</button>
    <button class="btn" type="submit" disabled={$routineManager.creating || !$routineManager.brief.trim()}>
      {$routineManager.creating ? "Building routine…" : "Build routine"}
    </button>
  </div>
</form>
