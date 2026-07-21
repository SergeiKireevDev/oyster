<script>
  import { appSession } from "../stores/appSession.js";
  import { sessionPicker } from "../stores/sessionPicker.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { runnerSessionIdentity, sameSession } from "../lib/sessionIdentity.js";
  import { SESSION_PICKER_SHOW_ACTION, SESSION_SIDEBAR_REFRESH_ACTION, SESSION_SWITCH_RUNNER_ACTION } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const switchRunner = (id) => uiActions.invoke(SESSION_SWITCH_RUNNER_ACTION, id);
  const showAllSessions = () => uiActions.invoke(SESSION_PICKER_SHOW_ACTION);
  const refreshSessions = () => uiActions.invoke(SESSION_SIDEBAR_REFRESH_ACTION);

  $: activeRunners = $appSession.runners.filter((runner) => runner.alive && runner.sessionId);
  let runnerSignature = "";
  $: {
    const nextSignature = activeRunners.map((runner) => `${runner.id}:${runner.sessionKey ?? runner.sessionId}`).join("|");
    if (nextSignature && nextSignature !== runnerSignature) {
      runnerSignature = nextSignature;
      queueMicrotask(refreshSessions);
    }
  }

  function savedSession(runner) {
    const identity = runnerSessionIdentity(runner);
    return [
      ...$sessionPicker.sessions,
      ...Object.values($sessionPicker.otherFolderSessions).flat(),
    ].find((session) => sameSession(session, identity));
  }

  function label(runner) {
    const session = savedSession(runner);
    return runner.sessionName || session?.name || session?.preview || `Session ${String(runner.sessionId).slice(0, 8)}`;
  }

  function folder(runner) {
    const value = runner.dir || "";
    return value.split(/[\\/]/).filter(Boolean).pop() || value;
  }
</script>

<aside id="sessions" aria-label="Sessions">
  <div class="side-head">Sessions</div>
  <div class="session-sidebar-list">
    {#if activeRunners.length}
      {#each activeRunners as runner (runner.id)}
        <button
          type="button"
          class:current={runner.id === $appSession.currentRunner}
          class:busy={runner.busy}
          class="session-sidebar-row"
          title={`${label(runner)}${runner.dir ? `\n${runner.dir}` : ""}`}
          onclick={() => switchRunner(runner.id)}
        >
          <span class="s-dot" class:on={!runner.busy} class:busy={runner.busy}></span>
          <span class="session-sidebar-copy">
            <span class="session-sidebar-name">{label(runner)}</span>
            {#if runner.dir}<span class="session-sidebar-folder">{folder(runner)}</span>{/if}
          </span>
        </button>
      {/each}
    {:else}
      <div class="r-empty">(no active sessions)</div>
    {/if}
  </div>
  <button type="button" class="session-sidebar-all" onclick={showAllSessions}>All sessions…</button>
</aside>
