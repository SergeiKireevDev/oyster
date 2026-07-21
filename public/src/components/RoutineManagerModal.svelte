<script>
  import { routineManager, updateRoutineManager } from "../stores/routineManager.js";
  import { closeModalState } from "../stores/modal.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { ROUTINE_GENERATE_ACTION } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const generateRoutine = () => uiActions.invoke(ROUTINE_GENERATE_ACTION, $routineManager.brief);
</script>

<div class="routine-generator">
  <div class="m-path">Describe a repeatable job. A background agent will write and register a run/teardown script for this session.</div>
  <textarea
    rows="6"
    placeholder="e.g. Rebuild the documentation site, report build progress, and remove generated files during teardown"
    value={$routineManager.brief}
    oninput={(event) => updateRoutineManager({ brief: event.currentTarget.value })}
  ></textarea>
</div>

<div class="m-actions" id="mActions">
  <button class="chip" data-modal-cancel disabled={$routineManager.creating} onclick={closeModalState}>Cancel</button>
  <button class="btn" disabled={$routineManager.creating || !$routineManager.brief.trim()} onclick={generateRoutine}>
    {$routineManager.creating ? "Building routine…" : "Build routine"}
  </button>
</div>
