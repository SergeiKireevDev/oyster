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

<form class="routine-manager-form" aria-busy={$routineManager.creating} onsubmit={submitRoutine}>
  <label for="routineBrief">
    <span class="routine-field">
      <span>Job brief</span>
      <small id="routineBriefHint">
        Describe the repeatable job, its meaningful progress steps, and anything teardown must remove.
      </small>
    </span>
  </label>
  <textarea
    id="routineBrief"
    class="routine-brief"
    rows="6"
    aria-describedby="routineBriefHint routineContractNote"
    placeholder="e.g. Rebuild the documentation site, report build progress, and remove generated files during teardown"
    value={$routineManager.brief}
    disabled={$routineManager.creating}
    oninput={updateBrief}
    required
  ></textarea>

  <p class="routine-contract" id="routineContractNote">
    <span class="routine-contract-label">Run + teardown</span>
    <span>A background agent will write and register both paths for this session.</span>
  </p>

  <div class="m-actions" id="mActions">
    <button
      class="chip"
      type="button"
      data-modal-cancel
      disabled={$routineManager.creating}
      onclick={closeModalState}
    >Cancel</button>
    <button
      class="btn routine-submit"
      class:building={$routineManager.creating}
      type="submit"
      disabled={$routineManager.creating || !$routineManager.brief.trim()}
    >
      {#if $routineManager.creating}
        <span class="spin" aria-hidden="true"></span>
        <span role="status" aria-live="polite" aria-atomic="true">Building routine…</span>
      {:else}
        Build routine
      {/if}
    </button>
  </div>
</form>

<style>
  .routine-manager-form,
  .routine-field {
    display: grid;
    min-width: 0;
  }

  .routine-manager-form { gap: 10px; }
  .routine-field { gap: 4px; }

  .routine-field > span {
    color: var(--text);
    font-size: 12px;
    font-weight: 620;
  }

  .routine-field > small {
    color: var(--muted);
    font-size: 10.5px;
    line-height: 1.45;
  }

  .routine-brief {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    min-height: 148px;
    max-height: 44dvh;
    margin: 0;
    background: var(--panel);
    line-height: 1.5;
    resize: vertical;
    transition: border-color .14s ease, background .14s ease, opacity .14s ease;
  }

  .routine-brief:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 46%, var(--border));
    background: color-mix(in srgb, var(--accent) 3%, var(--panel));
  }

  .routine-brief:focus-visible {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 3%, var(--panel));
  }

  .routine-brief:disabled {
    opacity: .58;
    cursor: not-allowed;
    resize: none;
  }

  .routine-contract {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
    border-radius: 9px;
    background: color-mix(in srgb, var(--accent) 5%, var(--panel));
    color: var(--muted);
    font-size: 10.5px;
    line-height: 1.45;
  }

  .routine-contract > span:last-child {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .routine-contract-label {
    flex: none;
    padding: 2px 6px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    border-radius: 999px;
    color: var(--accent);
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: .06em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .routine-submit {
    display: inline-flex;
    min-width: 132px;
    align-items: center;
    justify-content: center;
    gap: 7px;
  }

  .routine-submit.building:disabled {
    opacity: .78;
    cursor: wait;
  }

  @media (max-width: 760px) {
    .routine-brief { min-height: 132px; max-height: 38dvh; }
    .routine-manager-form .m-actions button { min-height: 40px; }
  }

  @media (max-width: 520px) {
    .routine-contract { align-items: flex-start; flex-direction: column; gap: 6px; }
    .routine-manager-form .m-actions button { flex: 1 1 132px; }
  }
</style>
