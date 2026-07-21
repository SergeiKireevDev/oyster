<script>
  import { routineCurrentSessionId, routines, routinesLoading, routineScopeAll, routinesTotal } from "../stores/routines.js";

  const dotClass = (status) => ({ running: "running", stopping: "running", teardown: "teardown", done: "done", failed: "failed", stopped: "stopped" }[status] ?? "");
  const msg = (routine) => routine.message ?? routine.log?.[routine.log.length - 1] ?? null;
  const title = (routine) => `${routine.path}\nstatus: ${routine.status}${routine.exitCode !== null ? ` (exit ${routine.exitCode})` : ""}${routine.sessionId ? `\nbound to session ${routine.sessionId}` : "\nnot bound to a session yet"}${routine.cwd ? `\nruns in ${routine.cwd}` : ""}`;
  import { runRoutineAction } from "../features/routines/routineActions.js";
  const confirmDelete = (routine) => {
    if (confirm(`Delete routine “${routine.name}”? Its script is removed from ~/.pi/routines/ (byproducts stay — teardown first if needed).`)) runRoutineAction(routine.name, "delete");
  };
</script>

<div id="routineList" style="display:contents">
  {#if $routinesLoading}
    <div class="sidebar-loading"><span class="spin"></span> loading routines…</div>
  {:else if !$routines.length}
    <div class="r-empty" title="put executable scripts in ~/.pi/routines/ — starting one binds it to the current session; it is run with “run”, torn down with “teardown”, and can print “::progress <0-100> <message>” lines to report progression">
      {$routinesTotal ? `(none for this session — ${$routinesTotal} bound elsewhere)` : "(none)"}
    </div>
  {:else}
    {#each $routines as routine (routine.name)}
      <div class="routine-block">
        <div class="r-head">
          <span class={`r-dot ${dotClass(routine.status)}`} title={routine.status}></span>
          <span class="r-name" title={title(routine)}>{routine.name}</span>
          {#if routine.status === "running" && routine.progress !== null}<span class="r-pct">{routine.progress}%</span>{/if}
          {#if $routineScopeAll && routine.sessionId}<span class="r-pct" title={`bound to session ${routine.sessionId}`}>{routine.sessionId === $routineCurrentSessionId ? "this session" : String(routine.sessionId).slice(0, 8)}</span>{/if}
        </div>
        {#if ["running", "stopping", "teardown"].includes(routine.status)}
          <div class={`r-bar${routine.status === "teardown" || !routine.progress ? " indet" : ""}`}><div style:width={`${routine.progress ?? 0}%`}></div></div>
        {/if}
        {#if msg(routine)}<div class="r-msg" title={(routine.log ?? []).slice(-15).join("\n") || msg(routine)}>{msg(routine)}</div>{/if}
        <div class="r-actions">
          {#if routine.alive}
            <button class="r-btn stop" title={routine.status === "teardown" ? "kill the teardown script" : "stop this routine (SIGTERM its process group)"} disabled={routine.status === "stopping"} onclick={() => runRoutineAction(routine.name, "stop")}>■ stop</button>
          {:else}
            <button class="r-btn" title="run this routine" onclick={() => runRoutineAction(routine.name, "start")}>▶ start</button>
            <button class="r-btn" title={`remove this routine's byproducts${routine.cwd ? ` (runs in ${routine.cwd})` : ""}`} onclick={() => runRoutineAction(routine.name, "teardown")}>🧹 teardown</button>
            {#if routine.sessionId}<button class="r-btn" title="unbind this routine from its session (byproducts stay — teardown first if needed)" onclick={() => runRoutineAction(routine.name, "release")}>✕ release</button>{/if}
            <button class="r-btn stop" title="delete this routine's script (byproducts stay — teardown first if needed)" onclick={() => confirmDelete(routine)}>🗑</button>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</div>
