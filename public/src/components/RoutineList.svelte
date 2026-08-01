<script>
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { ROUTINE_REFRESH_ACTION, ROUTINE_RUN_ACTION } from "../runtime/uiActionNames.js";
  import { routineCurrentSessionId, routines, routinesError, routinesLoading, routineScopeAll } from "../stores/routines.js";

  const ACTIVE_STATUSES = new Set(["running", "stopping", "teardown"]);
  const STATUS_CLASSES = {
    running: "running",
    stopping: "stopping",
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
  const pendingLabel = (routine) => ({
    start: "Starting…", stop: "Stopping…", teardown: "Tearing down…", release: "Releasing…", delete: "Deleting…",
  })[pendingActions[routine.name]] ?? "Working…";

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
      Loading routines…
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
          <span class={`r-dot ${dotClass(routine.status)}`} title={routine.status} aria-hidden="true"></span>
          <span class="r-name" title={routineTitle(routine)}>{routine.name}</span>
          <span class={`r-status ${dotClass(routine.status)}`}>{routine.status}</span>
          {#if routine.status === "running" && routine.progress !== null}
            <span class="r-pct" aria-hidden="true">{routine.progress}%</span>
          {/if}
          {#if $routineScopeAll && routine.sessionId}
            <span class="r-scope" title={`Bound to session ${routine.sessionId}`}>{scopeLabel(routine)}</span>
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
              class="r-btn danger"
              type="button"
              title={stopTitle(routine)}
              disabled={routine.status === "stopping" || routinePending(routine)}
              onclick={() => runRoutineAction(routine.name, "stop")}
            >stop</button>
          {:else}
            <button
              class="r-btn"
              type="button"
              title="Run this routine"
              disabled={routinePending(routine)}
              onclick={() => runRoutineAction(routine.name, "start")}
            >start</button>
            <button
              class="r-btn warning"
              type="button"
              title={teardownTitle(routine)}
              disabled={routinePending(routine)}
              onclick={() => runRoutineAction(routine.name, "teardown")}
            >teardown</button>
            {#if routine.sessionId}
              <button
                class="r-btn"
                type="button"
                title="Unbind this routine from its session (byproducts stay — teardown first if needed)"
                disabled={routinePending(routine)}
                onclick={() => runRoutineAction(routine.name, "release")}
              >release</button>
            {/if}
            <button
              class="r-btn danger"
              type="button"
              title="Delete this routine's script (byproducts stay — teardown first if needed)"
              aria-label={`Delete ${routine.name}`}
              disabled={routinePending(routine)}
              onclick={() => confirmDelete(routine)}
            >delete</button>
          {/if}
          {#if routinePending(routine)}
            <span class="r-pending" role="status" aria-atomic="true">
              <span class="spin" aria-hidden="true"></span>
              {pendingLabel(routine)}
            </span>
          {/if}
        </div>
      </article>
    {/each}
  {:else}
    <div class="r-empty" role="status" aria-atomic="true">No routines yet. Use + to build one.</div>
  {/if}
</div>

<style>
  #routineList { display: grid; min-width: 0; gap: 8px; }
  .routine-block { display: grid; min-width: 0; flex-shrink: 0; gap: 7px; padding: 10px; border: 1px solid color-mix(in srgb, var(--border) 82%, transparent); border-radius: 11px; background: color-mix(in srgb, var(--panel-2) 34%, transparent); font-size: 11.5px; }
  .r-head { display: flex; min-width: 0; align-items: center; gap: 6px; }
  .r-dot { width: 7px; height: 7px; border: 1px solid color-mix(in srgb, var(--muted) 45%, transparent); border-radius: 50%; flex: none; background: var(--stopped); }
  .r-dot.running { border-color: color-mix(in srgb, var(--accent) 48%, transparent); background: var(--accent); animation: routine-pulse 1.2s ease-in-out infinite; }
  .r-dot.stopping, .r-dot.teardown { border-color: color-mix(in srgb, var(--yellow) 48%, transparent); background: var(--yellow); animation: routine-pulse 1.2s ease-in-out infinite; }
  .r-dot.done { border-color: var(--green); background: var(--green); }
  .r-dot.failed { border-color: var(--red); background: var(--red); }
  .r-dot.stopped { background: var(--stopped); }
  .r-name { min-width: 0; flex: 1; overflow: hidden; color: var(--text); font-weight: 630; text-overflow: ellipsis; white-space: nowrap; }
  .r-status, .r-scope { max-width: 88px; overflow: hidden; color: var(--muted); font-size: 8.5px; font-weight: 700; letter-spacing: .08em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
  .r-status.running { color: var(--accent); }
  .r-status.stopping, .r-status.teardown { color: var(--yellow); }
  .r-status.done { color: var(--green); }
  .r-status.failed { color: var(--red); }
  .r-pct { color: var(--accent); font: 650 10px/1 var(--mono); font-variant-numeric: tabular-nums; }
  .r-scope { max-width: 100%; padding: 2px 5px; border: 1px solid var(--border); border-radius: 999px; letter-spacing: .04em; text-transform: none; }
  .r-bar { height: 4px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--border) 82%, transparent); }
  .r-bar > div { height: 100%; border-radius: inherit; background: var(--accent); transition: width .16s ease; }
  .r-bar.indet > div { width: 30% !important; animation: routine-slide 1.2s linear infinite; }
  .r-msg { min-width: 0; overflow: hidden; color: var(--muted); font: 10.5px/1.4 var(--mono); text-overflow: ellipsis; white-space: nowrap; }
  .r-actions { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 5px; }
  .r-btn { min-height: 28px; padding: 4px 8px; border: 1px solid var(--border); border-radius: 8px; background: color-mix(in srgb, var(--panel-2) 68%, transparent); color: var(--muted); font: inherit; font-size: 10.5px; font-weight: 600; cursor: pointer; transition: border-color .14s, background .14s, color .14s, transform .14s; }
  .r-btn.warning { border-color: color-mix(in srgb, var(--yellow) 24%, var(--border)); background: color-mix(in srgb, var(--yellow) 5%, var(--panel-2)); }
  .r-btn.danger { border-color: color-mix(in srgb, var(--red) 24%, var(--border)); background: color-mix(in srgb, var(--red) 5%, var(--panel-2)); }
  .r-btn:hover:not(:disabled) { border-color: color-mix(in srgb, var(--accent) 42%, var(--border)); background: var(--surface-hover); color: var(--text); transform: translateY(-1px); }
  .r-btn.warning:hover:not(:disabled) { border-color: var(--yellow); background: color-mix(in srgb, var(--yellow) 9%, var(--panel-2)); color: var(--yellow); }
  .r-btn.danger:hover:not(:disabled) { border-color: var(--red); background: color-mix(in srgb, var(--red) 9%, var(--panel-2)); color: var(--red); }
  .r-btn:active:not(:disabled) { transform: translateY(0); }
  .r-btn:disabled { opacity: .45; cursor: not-allowed; transform: none; }
  .r-pending { display: inline-flex; min-width: 0; align-items: center; gap: 5px; color: var(--muted); font-size: 9.5px; }
  .r-pending .spin { width: 10px; height: 10px; }
  .r-empty { min-width: 0; padding: 11px 9px; border: 1px dashed var(--border); border-radius: 10px; color: var(--muted); font-size: 10.5px; line-height: 1.45; overflow-wrap: anywhere; text-align: center; }
  .r-empty.async-error { border-color: color-mix(in srgb, var(--red) 38%, var(--border)); color: var(--red); }
  .r-empty .r-btn { margin-left: 5px; }
  @keyframes routine-pulse { 50% { opacity: .42; } }
  @keyframes routine-slide { from { transform: translateX(-100%); } to { transform: translateX(334%); } }
  @media (max-width: 760px) {
    #routineList { gap: 10px; }
    .routine-block { padding: 11px; }
    .r-actions { gap: 6px; }
    .r-btn { min-height: 40px; padding-inline: 11px; }
    .r-empty .r-btn { min-height: 40px; }
  }
  @media (max-width: 520px) {
    .r-status { max-width: 72px; }
    .r-btn { flex: 1 1 calc(50% - 3px); }
    .r-pending { flex-basis: 100%; }
  }
</style>
