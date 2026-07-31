<script>
  import { routineCurrentSessionId, routines, routinesError, routinesLoading, routineScopeAll } from "../stores/routines.js";

  const dotClass = (status) => ({ running: "running", stopping: "running", teardown: "teardown", done: "done", failed: "failed", stopped: "stopped" }[status] ?? "");
  const msg = (routine) => routine.message ?? routine.log?.[routine.log.length - 1] ?? null;
  const title = (routine) => `${routine.path}\nstatus: ${routine.status}${routine.exitCode !== null ? ` (exit ${routine.exitCode})` : ""}${routine.sessionId ? `\nbound to session ${routine.sessionId}` : "\nnot bound to a session yet"}${routine.cwd ? `\nruns in ${routine.cwd}` : ""}`;
  const isActive = (routine) => ["running", "stopping", "teardown"].includes(routine.status);
  const progressClass = (routine) => `r-bar${routine.status === "teardown" || !routine.progress ? " indet" : ""}`;
  const progressWidth = (routine) => `${routine.progress ?? 0}%`;
  const progressValue = (routine) => routine.progress ?? undefined;
  const progressText = (routine) => msg(routine) ?? (routine.progress === null ? routine.status : undefined);
  const scopeLabel = (routine) => routine.sessionId === $routineCurrentSessionId ? "this session" : String(routine.sessionId).slice(0, 8);
  const logTitle = (routine) => (routine.log ?? []).slice(-15).join("\n") || msg(routine);
  const stopTitle = (routine) => routine.status === "teardown" ? "kill the teardown script" : "stop this routine (SIGTERM its process group)";
  const teardownTitle = (routine) => `remove this routine's byproducts${routine.cwd ? ` (runs in ${routine.cwd})` : ""}`;
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { ROUTINE_REFRESH_ACTION, ROUTINE_RUN_ACTION } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const runRoutineAction = (name, action) => uiActions.invoke(ROUTINE_RUN_ACTION, name, action);
  const refreshRoutines = () => uiActions.invoke(ROUTINE_REFRESH_ACTION);
  const confirmDelete = (routine) => {
    if (confirm(`Delete routine “${routine.name}”? Its script is removed from ~/.pi/routines/ (byproducts stay — teardown first if needed).`)) runRoutineAction(routine.name, "delete");
  };
</script>

<div id="routineList">
  {#if $routinesLoading}
    <div class="sidebar-loading" role="status"><span class="spin"></span> loading routines…</div>
  {:else if $routinesError}
    <div class="r-empty async-error" role="alert">Could not load routines: {$routinesError} <button class="r-btn" type="button" onclick={refreshRoutines}>Retry</button></div>
  {:else if $routines.length}
    {#each $routines as routine (routine.name)}
      <div class="routine-block">
        <div class="r-head">
          <span class={`r-dot ${dotClass(routine.status)}`} title={routine.status}></span>
          <span class="r-name" title={title(routine)}>{routine.name}</span>
          {#if routine.status === "running" && routine.progress !== null}<span class="r-pct" aria-hidden="true">{routine.progress}%</span>{/if}
          {#if $routineScopeAll && routine.sessionId}<span class="r-pct" title={`bound to session ${routine.sessionId}`}>{scopeLabel(routine)}</span>{/if}
        </div>
        {#if isActive(routine)}
          <div
            class={progressClass(routine)}
            role="progressbar"
            aria-label={`${routine.name} progress`}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={progressValue(routine)}
            aria-valuetext={progressText(routine)}
          ><div style:width={progressWidth(routine)}></div></div>
        {/if}
        {#if msg(routine)}<div class="r-msg" title={logTitle(routine)} aria-live="off">{msg(routine)}</div>{/if}
        <div class="r-actions">
          {#if routine.alive}
            <button class="r-btn stop" title={stopTitle(routine)} disabled={routine.status === "stopping"} onclick={() => runRoutineAction(routine.name, "stop")}>■ stop</button>
          {:else}
            <button class="r-btn" title="run this routine" onclick={() => runRoutineAction(routine.name, "start")}>▶ start</button>
            <button class="r-btn" title={teardownTitle(routine)} onclick={() => runRoutineAction(routine.name, "teardown")}>🧹 teardown</button>
            {#if routine.sessionId}<button class="r-btn" title="unbind this routine from its session (byproducts stay — teardown first if needed)" onclick={() => runRoutineAction(routine.name, "release")}>✕ release</button>{/if}
            <button class="r-btn stop" title="delete this routine's script (byproducts stay — teardown first if needed)" aria-label={`Delete ${routine.name}`} onclick={() => confirmDelete(routine)}>🗑</button>
          {/if}
        </div>
      </div>
    {/each}
  {:else}
    <div class="r-empty" role="status">No routines yet. Use + to build one.</div>
  {/if}
</div>
