<script>
  import { onDestroy } from "svelte";
  import { appSession } from "../stores/appSession.js";
  import { sessionPicker, updateSessionPicker } from "../stores/sessionPicker.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { runnerSessionIdentity, sameSession } from "../lib/sessionIdentity.js";
  import {
    SESSION_PICKER_OPEN_SEARCH_HIT_ACTION,
    SESSION_PICKER_SEARCH_ACTION,
    SESSION_PICKER_SET_SCOPE_ACTION,
    SESSION_PICKER_SHOW_ACTION,
    SESSION_SIDEBAR_REFRESH_ACTION,
    SESSION_SWITCH_RUNNER_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const switchRunner = (id) => uiActions.invoke(SESSION_SWITCH_RUNNER_ACTION, id);
  const showAllSessions = () => uiActions.invoke(SESSION_PICKER_SHOW_ACTION);
  const refreshSessions = () => uiActions.invoke(SESSION_SIDEBAR_REFRESH_ACTION);
  const openSearchHit = (group, hit) => uiActions.invoke(SESSION_PICKER_OPEN_SEARCH_HIT_ACTION, group.sessionKey, hit);

  let searchTimer = null;
  function updateQuery(value) {
    updateSessionPicker({
      query: value,
      ...(value.trim().length < 2 ? { searchStatus: "", searchResults: [], searching: false } : {}),
    });
    clearTimeout(searchTimer);
    if (value.trim().length < 2) return;
    searchTimer = setTimeout(() => {
      uiActions.invoke(SESSION_PICKER_SET_SCOPE_ACTION, "all");
      uiActions.invoke(SESSION_PICKER_SEARCH_ACTION);
    }, 250);
  }
  onDestroy(() => clearTimeout(searchTimer));

  $: searching = $sessionPicker.query.trim().length >= 2;
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
  <input
    class="session-sidebar-search"
    type="search"
    placeholder="search sessions…"
    value={$sessionPicker.query}
    oninput={(event) => updateQuery(event.currentTarget.value)}
    onkeydown={(event) => {
      if (event.key === "Enter" && event.currentTarget.value.trim().length >= 2) {
        clearTimeout(searchTimer);
        uiActions.invoke(SESSION_PICKER_SET_SCOPE_ACTION, "all");
        uiActions.invoke(SESSION_PICKER_SEARCH_ACTION);
      }
    }}
  />
  <div class="session-sidebar-list">
    {#if searching}
      {#if $sessionPicker.searchStatus}<div class="session-sidebar-status">{$sessionPicker.searchStatus}</div>{/if}
      {#each $sessionPicker.searchResults as group (group.sessionKey)}
        <button
          type="button"
          class="session-sidebar-hit"
          title={group.sessionKey}
          onclick={() => openSearchHit(group, group.hits[0])}
        >
          <span class="session-sidebar-name">{group.first.sessionName || group.first.sessionPreview || "(unnamed session)"}</span>
          <span class="session-sidebar-folder">{group.hits.length} hit{group.hits.length === 1 ? "" : "s"}{group.first.folderLabel ? ` · ${group.first.folderLabel}` : ""}</span>
          {#each group.hits.slice(0, 2) as hit}
            <span class="session-sidebar-snippet">
              <span class="s-role">{hit.role === "user" ? "you" : hit.role === "assistant" ? "ai" : hit.role === "toolResult" ? "tool" : hit.kind}</span>
              {" "}{hit.snippet.before}<mark>{hit.snippet.match}</mark>{hit.snippet.after}
            </span>
          {/each}
        </button>
      {/each}
    {:else if activeRunners.length}
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
