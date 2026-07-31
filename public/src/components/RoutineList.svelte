<script>
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { ROUTINE_REFRESH_ACTION, ROUTINE_RUN_ACTION } from "../runtime/uiActionNames.js";
  import { routineCurrentSessionId, routines, routinesError, routinesLoading, routineScopeAll } from "../stores/routines.js";

  const ACTIVE_STATUSES = new Set(["running", "stopping", "teardown"]);
  const STATUS_CLASSES = {
    running: "running",
    stopping: "running",
    teardown: "teardown",
    done: "done",
    failed: "failed",
    stopped: "stopped",
  };

  const uiActions = getUiActionRegistry();
  let pendingActions = $state({});

  const dotClass = (status) => STATUS_CLASSES[status] ?? "";
  const routineMessage = (routine) => routine.message ?? routine.log?.at(-1) ?? null;
  const isActive = (routine) => ACTIVE_STATUSES.has(routine.status);
  const progressClass = (routine) => `r-bar${routine.status === "teardown" || routine.progress === null ? " indet" : ""}`;
  const progressWidth = (routine) => `${routine.progress ?? 0}%`;
  const progressValue = (routine) => routine.progress ?? undefined;
  const progressText = (routine, message) => message ?? (routine.progress === null ? routine.status : undefined);
  const scopeLabel = (routine) => routine.sessionId === $routineCurrentSessionId
    ? "this session"
    : String(routine.sessionId).slice(0, 8);
  const logTitle = (routine, message) => (routine.log ?? []).slice(-15).join("\n") || message;
  const stopTitle = (routine) => routine.status === "teardown"
    ? "Kill the teardown script"
    : "Stop this routine (SIGTERM its process group)";
  const teardownTitle = (routine) => `Remove this routine's byproducts${routine.cwd ? ` (runs in ${routine.cwd})` : ""}`;
  const routineTitle = (routine) => {
    const exit = routine.exitCode == null ? "" : ` (exit ${routine.exitCode})`;
    const binding = routine.sessionId ? `bound to session ${routine.sessionId}` : "not bound to a session yet";
    const cwd = routine.cwd ? `\nruns in ${routine.cwd}` : "";
    return `${routine.path}\nstatus: ${routine.status}${exit}\n${binding}${cwd}`;
  };
  const routinePending = (routine) => Boolean(pendingActions[routine.name]);

  async function runRoutineAction(name, action) {
    if (pendingActions[name]) return;
    pendingActions = { ...pendingActions, [name]: action };
    try {
      await uiActions.invoke(ROUTINE_RUN_ACTION, name, action);
    } finally {
      const { [name]: _completedAction, ...remainingActions } = pendingActions;
      pendingActions = remainingActions;
    }
  }

  function refreshRoutines() {
    uiActions.invoke(ROUTINE_REFRESH_ACTION);
  }

  function confirmDelete(routine) {
    const confirmed = confirm(
      `Delete routine “${routine.name}”? Its script is removed from ~/.pi/routines/ (byproducts stay — teardown first if needed).`,
    );
    if (confirmed) runRoutineAction(routine.name, "delete");
  }
</script>

<div id="routineList" aria-busy={$routinesLoading}>
  {#if $routinesLoading}
    <div class="sidebar-loading" role="status" aria-atomic="true">
      <span class="spin" aria-hidden="true"></span>
      loading routines…
    </div>
  {:else if $routinesError}
    <div class="r-empty async-error" role="alert" aria-atomic="true">
      Could not load routines: {$routinesError}
      <button class="r-btn" type="button" onclick={refreshRoutines}>Retry</button>
    </div>
  {:else if $routines.length}
    {#each $routines as routine (routine.name)}
      {@const message = routineMessage(routine)}
      <article class="routine-block" aria-label={`${routine.name} routine`}>
        <div class="r-head">
          <span
            class={`r-dot ${dotClass(routine.status)}`}
            role="img"
            aria-label={`Status: ${routine.status}`}
            title={routine.status}
          ></span>
          <span class="r-name" title={routineTitle(routine)}>{routine.name}</span>
          {#if routine.status === "running" && routine.progress !== null}
            <span class="r-pct" aria-hidden="true">{routine.progress}%</span>
          {/if}
          {#if $routineScopeAll && routine.sessionId}
            <span class="r-pct" title={`Bound to session ${routine.sessionId}`}>{scopeLabel(routine)}</span>
          {/if}
        </div>
        {#if isActive(routine)}
          <div
            class={progressClass(routine)}
            role="progressbar"
            aria-label={`${routine.name} progress`}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={progressValue(routine)}
            aria-valuetext={progressText(routine, message)}
          ><div style:width={progressWidth(routine)}></div></div>
        {/if}
        {#if message}
          <div class="r-msg" title={logTitle(routine, message)} aria-live="off">{message}</div>
        {/if}
        <div class="r-actions" role="group" aria-label={`${routine.name} actions`} aria-busy={routinePending(routine)}>
          {#if routine.alive}
            <button
              class="r-btn stop"
              type="button"
              title={stopTitle(routine)}
              disabled={routine.status === "stopping" || routinePending(routine)}
              onclick={() => runRoutineAction(routine.name, "stop")}
            >■ stop</button>
          {:else}
            <button
              class="r-btn"
              type="button"
              title="Run this routine"
              disabled={routinePending(routine)}
              onclick={() => runRoutineAction(routine.name, "start")}
            >▶ start</button>
            <button
              class="r-btn"
              type="button"
              title={teardownTitle(routine)}
              disabled={routinePending(routine)}
              onclick={() => runRoutineAction(routine.name, "teardown")}
            >🧹 teardown</button>
            {#if routine.sessionId}
              <button
                class="r-btn"
                type="button"
                title="Unbind this routine from its session (byproducts stay — teardown first if needed)"
                disabled={routinePending(routine)}
                onclick={() => runRoutineAction(routine.name, "release")}
              >✕ release</button>
            {/if}
            <button
              class="r-btn stop"
              type="button"
              title="Delete this routine's script (byproducts stay — teardown first if needed)"
              aria-label={`Delete ${routine.name}`}
              disabled={routinePending(routine)}
              onclick={() => confirmDelete(routine)}
            >🗑</button>
          {/if}
        </div>
      </article>
    {/each}
  {:else}
    <div class="r-empty" role="status" aria-atomic="true">No routines yet. Use + to build one.</div>
  {/if}
</div>
