<script>
  import { onDestroy } from "svelte";
  import { appSession } from "../stores/appSession.js";
  import { sessionPicker, updateSessionPicker } from "../stores/sessionPicker.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { runnerSessionIdentity, sameSession, sessionIdentity } from "../lib/sessionIdentity.js";
  import { formatRelativeTime } from "../lib/relativeTime.js";
  import { groupSessionsByCwd, partitionSessionGroupsByArchive } from "../features/sessions/sessionPickerViewModel.js";
  import {
    SESSION_PICKER_CHOOSE_ACTION,
    SESSION_PICKER_DELETE_ACTION,
    SESSION_PICKER_OPEN_SEARCH_HIT_ACTION,
    SESSION_PICKER_SEARCH_ACTION,
    SESSION_PICKER_SET_SCOPE_ACTION,
    SESSION_PICKER_STOP_ACTION,
    SESSION_SIDEBAR_CREATE_IN_CWD_ACTION,
    SESSION_SIDEBAR_CREATE_IN_FOLDER_ACTION,
    SESSION_SIDEBAR_REFRESH_ACTION,
    SESSION_SWITCH_RUNNER_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const switchRunner = (id) => uiActions.invoke(SESSION_SWITCH_RUNNER_ACTION, id);
  const openSavedSession = (session) => uiActions.invoke(SESSION_PICKER_CHOOSE_ACTION, sessionIdentity(session));
  const refreshSessions = () => uiActions.invoke(SESSION_SIDEBAR_REFRESH_ACTION);
  const createSessionInCwd = (cwd) => uiActions.invoke(SESSION_SIDEBAR_CREATE_IN_CWD_ACTION, cwd);
  const createSessionInFolder = () => uiActions.invoke(SESSION_SIDEBAR_CREATE_IN_FOLDER_ACTION);
  const openSearchHit = (group, hit) => uiActions.invoke(SESSION_PICKER_OPEN_SEARCH_HIT_ACTION, group.sessionKey, hit);
  const stopSession = (runner) => uiActions.invoke(SESSION_PICKER_STOP_ACTION, savedSession(runner) ?? runner);
  const deleteSession = (runner) => uiActions.invoke(SESSION_PICKER_DELETE_ACTION, savedSession(runner) ?? runner);

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
  let clock = Date.now();
  const clockTimer = setInterval(() => { clock = Date.now(); }, 60_000);
  onDestroy(() => {
    clearTimeout(searchTimer);
    clearInterval(clockTimer);
  });

  $: searching = $sessionPicker.query.trim().length >= 2;
  $: sidebarRunners = $appSession.runners.filter((runner) => runner.sessionId);
  $: currentCwd = $appSession.runners.find((runner) => runner.id === $appSession.currentRunner)?.dir ?? null;
  $: sessionGroups = partitionSessionGroupsByArchive(
    groupSessionsByCwd($sessionPicker.allSessions, sidebarRunners),
  );
  let expandedCwds = new Set();
  let initializedCwdExpansion = false;
  $: if (!initializedCwdExpansion && currentCwd) {
    initializedCwdExpansion = true;
    expandedCwds = new Set([`recent:${currentCwd}`]);
  }
  function cwdExpansionKey(group) {
    return `${group.archived ? "archived" : "recent"}:${group.cwd}`;
  }
  function setCwdExpanded(key, open) {
    const next = new Set(expandedCwds);
    if (open) next.add(key);
    else next.delete(key);
    expandedCwds = next;
  }
  let runnerSignature = "";
  $: {
    const nextSignature = sidebarRunners.map((runner) => [
      runner.id,
      runner.sessionKey ?? runner.sessionId,
      runner.sessionName ?? "",
      runner.alive ? (runner.busy ? "busy" : "idle") : "stopped",
    ].join(":")).join("|");
    if (nextSignature && nextSignature !== runnerSignature) {
      runnerSignature = nextSignature;
      queueMicrotask(refreshSessions);
    }
  }

  function savedSession(runner) {
    const identity = runnerSessionIdentity(runner);
    return [
      ...$sessionPicker.allSessions,
      ...$sessionPicker.sessions,
      ...Object.values($sessionPicker.otherFolderSessions).flat(),
    ].find((session) => sameSession(session, identity));
  }

  function label(session, runner) {
    return runner?.sessionName || session?.name || session?.preview || `Session ${String(runner?.sessionId ?? session?.id).slice(0, 8)}`;
  }

  function cwdLabel(cwd) {
    return cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
  }

  function snippetBefore(value, limit = 48) {
    const text = String(value ?? "").replace(/^…/, "");
    return text.length > limit ? `…${text.slice(-limit)}` : `${value?.startsWith?.("…") ? "…" : ""}${text}`;
  }

  function snippetAfter(value, limit = 70) {
    const text = String(value ?? "").replace(/…$/, "");
    return text.length > limit ? `${text.slice(0, limit)}…` : `${text}${value?.endsWith?.("…") ? "…" : ""}`;
  }

  function sessionMeta(session, runner) {
    const modifiedAt = session?.modifiedAt ?? runner?.modifiedAt;
    const messageCount = session?.messageCount ?? runner?.messageCount;
    const parts = [];
    const relative = formatRelativeTime(modifiedAt, clock);
    if (relative) parts.push(`Last message ${relative}`);
    if (Number.isFinite(Number(messageCount))) parts.push(`${messageCount} msg${Number(messageCount) === 1 ? "" : "s"}`);
    return parts.join(" · ");
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
  {#if !searching}
    <div class="session-sidebar-new">
      <button
        type="button"
        class="session-sidebar-create"
        id="newSessionHere"
        disabled={!currentCwd}
        onclick={() => currentCwd && createSessionInCwd(currentCwd)}
      >
        <span class="session-sidebar-create-icon" aria-hidden="true">+</span>
        <span class="session-sidebar-create-copy">
          <strong>New session</strong>
          <small>{currentCwd ? `Current folder: ${cwdLabel(currentCwd)}` : "Current folder unavailable"}</small>
        </span>
      </button>
      <button
        type="button"
        class="session-sidebar-create-folder"
        id="newSessionFolder"
        title="Choose another folder"
        aria-label="Choose another folder for a new session"
        onclick={createSessionInFolder}
      ><span class="session-sidebar-create-chevron" aria-hidden="true"></span></button>
    </div>
  {/if}
  <div class="session-sidebar-list">
    {#if searching}
      {#if $sessionPicker.searchStatus}<div class="session-sidebar-status">{$sessionPicker.searchStatus}</div>{/if}
      {#each $sessionPicker.searchResults as group (group.sessionKey)}
        <section class="session-sidebar-hit-group" title={group.sessionKey}>
          <div class="session-sidebar-hit-heading">
            <span class="session-sidebar-name">{group.first.sessionName || group.first.sessionPreview || "(unnamed session)"}</span>
            <span class="session-sidebar-hit-count">{group.hits.length}</span>
          </div>
          <span
            class="session-sidebar-folder"
            title={group.first.sessionCwd || group.first.folderLabel || ""}
          >{group.first.sessionCwd || group.first.folderLabel || "Unknown working directory"}</span>
          <div class="session-sidebar-hit-list">
            {#each group.hits as hit (hit.entryId ?? `${hit.role}:${hit.timestamp}:${hit.snippet.match}`)}
              <button
                type="button"
                class="session-sidebar-hit"
                onclick={() => openSearchHit(group, hit)}
              >
                <span class="session-sidebar-snippet">
                  <span class="s-role">{hit.role === "user" ? "you" : hit.role === "assistant" ? "ai" : hit.role === "toolResult" ? "tool" : hit.kind}</span>
                  <span class="session-sidebar-snippet-copy">{snippetBefore(hit.snippet.before)}<mark>{hit.snippet.match}</mark>{snippetAfter(hit.snippet.after)}</span>
                </span>
              </button>
            {/each}
          </div>
        </section>
      {/each}
    {:else if sessionGroups.length}
      {#each sessionGroups as group (`${group.archived ? "archived" : "recent"}:${group.cwd}`)}
        {#if group.firstArchived}
          <div class="session-archive-divider">
            <span>Archived</span>
            <small>head older than 2 days</small>
          </div>
        {/if}
        <details
          class="session-sidebar-cwd"
          open={expandedCwds.has(cwdExpansionKey(group))}
          ontoggle={(event) => setCwdExpanded(cwdExpansionKey(group), event.currentTarget.open)}
        >
          <summary title={group.cwd}>
            <span>{cwdLabel(group.cwd)}</span>
            <span class="session-sidebar-count">{group.entries.length}</span>
          </summary>
          <div class="session-sidebar-cwd-list">
            {#each group.entries as entry (entry.session ? sessionIdentity(entry.session) : entry.runner.id)}
              {@const session = entry.session}
              {@const runner = entry.runner}
              {@const current = runner?.id === $appSession.currentRunner || (!runner && session?.id === $sessionPicker.currentId)}
              <div class="session-sidebar-entry" class:current>
                <button
                  type="button"
                  class:busy={runner?.busy}
                  class="session-sidebar-row"
                  title={`${label(session, runner)}\n${group.cwd}`}
                  onclick={() => runner ? switchRunner(runner.id) : openSavedSession(session)}
                >
                  <span class="s-dot" class:on={runner?.alive && !runner?.busy} class:busy={runner?.alive && runner?.busy}></span>
                  <span class="session-sidebar-copy">
                    <span class="session-sidebar-name">{label(session, runner)}</span>
                    {#if sessionMeta(session, runner)}
                      <span class="session-sidebar-meta">{sessionMeta(session, runner)}</span>
                    {/if}
                  </span>
                </button>
                {#if runner?.alive}
                  <button type="button" class="session-sidebar-action stop" title="Stop this session's process" aria-label="Stop this session's process" onclick={() => stopSession(runner)}></button>
                {:else if group.archived && !current}
                  <button type="button" class="session-sidebar-action delete" title="Delete archived session" aria-label="Delete archived session" onclick={() => deleteSession(session ?? runner)}>✕</button>
                {:else if !group.archived}
                  <span class="session-sidebar-lifecycle archive" title="Archives when its head is older than 2 days" aria-label="Waiting to archive"></span>
                {/if}
              </div>
            {/each}
          </div>
        </details>
      {/each}
    {:else}
      <div class="r-empty">(no active sessions)</div>
    {/if}
  </div>
</aside>
