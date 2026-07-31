<script>
  import { onDestroy } from "svelte";
  import FolderIcon from "./FolderIcon.svelte";
  import SearchHitSnippet from "./SearchHitSnippet.svelte";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    SESSION_PICKER_CANCEL_ACTION,
    SESSION_PICKER_CHOOSE_ACTION,
    SESSION_PICKER_DELETE_ACTION,
    SESSION_PICKER_LOAD_FOLDER_ACTION,
    SESSION_PICKER_OPEN_SEARCH_HIT_ACTION,
    SESSION_PICKER_SEARCH_ACTION,
    SESSION_PICKER_SET_EXCLUDE_TOOLS_ACTION,
    SESSION_PICKER_SET_FOLDER_ACTION,
    SESSION_PICKER_SET_SCOPE_ACTION,
    SESSION_PICKER_STOP_ACTION,
  } from "../runtime/uiActionNames.js";
  import { sessionPicker, updateSessionPicker } from "../stores/sessionPicker.js";
  import { partitionSessionFamilies, prepareSessionFamilies } from "../features/sessions/sessionPickerViewModel.js";
  import { runnerSessionIdentity, sessionIdentity } from "../lib/sessionIdentity.js";
  import { formatRelativeTime } from "../lib/relativeTime.js";
  import { abbreviateHomePath } from "../lib/pathDisplay.js";
  import { isHubRuntime } from "../runtime/workspaceScope.js";

  const uiActions = getUiActionRegistry();
  const hubMode = isHubRuntime();
  const choosePickedSession = (...args) => uiActions.invoke(SESSION_PICKER_CHOOSE_ACTION, ...args);
  const deletePickedSession = (...args) => uiActions.invoke(SESSION_PICKER_DELETE_ACTION, ...args);
  const loadPickedSessionFolder = (...args) => uiActions.invoke(SESSION_PICKER_LOAD_FOLDER_ACTION, ...args);
  const openPickedSearchHit = (...args) => uiActions.invoke(SESSION_PICKER_OPEN_SEARCH_HIT_ACTION, ...args);
  const runSessionPickerSearch = () => uiActions.invoke(SESSION_PICKER_SEARCH_ACTION);
  const setSessionPickerExcludeTools = (...args) => uiActions.invoke(SESSION_PICKER_SET_EXCLUDE_TOOLS_ACTION, ...args);
  const setSessionPickerFolder = (...args) => uiActions.invoke(SESSION_PICKER_SET_FOLDER_ACTION, ...args);
  const setSessionPickerScope = (...args) => uiActions.invoke(SESSION_PICKER_SET_SCOPE_ACTION, ...args);
  const stopPickedSession = (...args) => uiActions.invoke(SESSION_PICKER_STOP_ACTION, ...args);
  const cancelSessionPicker = () => uiActions.invoke(SESSION_PICKER_CANCEL_ACTION);

  function fmtSessionDate(ts) {
    return formatRelativeTime(ts);
  }

  $: isSearching = $sessionPicker.query.trim().length >= 3;
  $: runnerByIdentity = new Map($sessionPicker.runners.map((runner) => [runnerSessionIdentity(runner), runner]));

  function folderOf(path) {
    return String(path ?? "").slice(0, String(path ?? "").lastIndexOf("/"));
  }

  function labelFor(dir) {
    const label = $sessionPicker.folders.find((folder) => folder.dir === dir)?.label ?? (dir === $sessionPicker.currentFolder ? $sessionPicker.currentWorkdir : dir) ?? "?";
    return abbreviateHomePath(label);
  }

  function runnerFor(session) {
    return runnerByIdentity.get(sessionIdentity(session)) ?? { id: session.runnerId, alive: session.alive, busy: session.busy };
  }

  function isAlive(session) {
    const runner = runnerFor(session);
    return !!(runner?.alive ?? session.alive);
  }

  function isBusy(session) {
    const runner = runnerFor(session);
    return !!(runner?.busy ?? session.busy);
  }

  function childSessionsOpen(family) {
    const key = sessionIdentity(family.session);
    const choices = $sessionPicker.expandedChildFamilies ?? {};
    return Object.hasOwn(choices, key)
      ? choices[key]
      : family.forks.some((fork) => fork.id === $sessionPicker.currentId)
        || (family.loop && family.forks.some(isAlive));
  }

  function setChildSessionsOpen(family, open) {
    const key = sessionIdentity(family.session);
    updateSessionPicker({
      expandedChildFamilies: { ...($sessionPicker.expandedChildFamilies ?? {}), [key]: open },
    });
  }

  function loopSessionStatus(session) {
    const runner = runnerFor(session);
    if (runner?.alive) return "running";
    if (["succeeded", "failed"].includes(runner?.subagentStatus)) return runner.subagentStatus;
    return "succeeded";
  }

  function loopFamilySummary(family) {
    const statuses = family.forks.map(loopSessionStatus);
    const running = statuses.filter((status) => status === "running").length;
    const failed = statuses.filter((status) => status === "failed").length;
    const complete = statuses.length - running;
    if (running) return { status: "running", label: `${complete}/${statuses.length} complete · running` };
    if (failed) return { status: "failed", label: `${failed} failed · ${complete}/${statuses.length} complete` };
    return { status: "succeeded", label: `${complete}/${statuses.length} complete` };
  }

  function searchGroupMeta(group) {
    const workspace = hubMode && group.first.workspaceName ? `${group.first.workspaceName} · ` : "";
    const folder = $sessionPicker.scope === "all" ? `${abbreviateHomePath(group.first.folderLabel)} · ` : "";
    return `${workspace}${folder}${group.hits.length} hit${group.hits.length === 1 ? "" : "s"}`;
  }

  const sessionDotClass = (alive, busy) => `s-dot${busy ? " busy" : alive ? " on" : ""}`;
  const sessionDotTitle = (alive, busy) => busy ? "agent working" : alive ? "process running (idle)" : "no running process";
  const sessionDateMeta = (session) => `${hubMode && session.workspaceName ? `${session.workspaceName} · ` : ""}${fmtSessionDate(session.modifiedAt)} · ${session.messageCount} msgs`;
  const plural = (count, singular, pluralForm = `${singular}s`) => count === 1 ? singular : pluralForm;

  function searchResultName(group) {
    return group.first.sessionName || group.first.sessionPreview || "(unnamed session)";
  }

  function sessionName(session, fallback = "(empty session)") {
    return session.name || session.preview || fallback;
  }


  function sessionRowClass(current, timelineStatus) {
    const currentClass = current ? " current" : "";
    const timelineClass = timelineStatus ? ` s-loop-iteration status-${timelineStatus}` : "";
    return `m-option session-row${currentClass}${timelineClass}`;
  }

  function openSearchResult(event, group) {
    const snippet = event.target.closest?.(".s-snippet");
    const index = Number(snippet?.dataset?.hitIndex ?? 0);
    openPickedSearchHit(group.sessionKey, group.hits[index] ?? group.hits[0]);
  }

  $: currentPartition = partitionSessionFamilies($sessionPicker.sessions, isAlive);
  $: currentFamilies = {
    active: prepareSessionFamilies(currentPartition.active),
    inactive: prepareSessionFamilies(currentPartition.inactive),
  };
  $: otherFolders = $sessionPicker.folders.filter((folder) => folder.dir !== $sessionPicker.currentFolder);
  $: activeOtherFolders = (() => {
    const map = new Map();
    for (const runner of $sessionPicker.runners) {
      if (!runner.alive || !runner.sessionFile) continue;
      const dir = folderOf(runner.sessionFile);
      if (dir === $sessionPicker.currentFolder) continue;
      if (!map.has(dir)) map.set(dir, new Set());
      map.get(dir).add(runner.sessionFile);
    }
    return [...map].map(([dir, paths]) => ({
      dir,
      families: prepareSessionFamilies(($sessionPicker.otherFolderSessions[dir] ?? []).filter((session) => paths.has(session.path))),
    }));
  })();
  $: inactiveOtherFolderFamilies = new Map(otherFolders.map((folder) => [
    folder.dir,
    prepareSessionFamilies(($sessionPicker.otherFolderSessions[folder.dir] ?? []).filter((session) => !isAlive(session))),
  ]));

  let debounce = null;
  function focusOnMount(node) {
    queueMicrotask(() => node.focus());
  }
  function queryInput(value) {
    updateSessionPicker({
      query: value,
      ...(value.trim().length < 3 ? { searchStatus: "", searchResults: [], searching: false } : {}),
    });
    clearTimeout(debounce);
    debounce = setTimeout(() => runSessionPickerSearch(), 250);
  }

  onDestroy(() => clearTimeout(debounce));
</script>

<form class="search-row" role="search" onsubmit={(event) => { event.preventDefault(); clearTimeout(debounce); runSessionPickerSearch(); }}>
  <input
    type="search"
    aria-label="Search sessions"
    placeholder="search sessions…"
    bind:value={$sessionPicker.query}
    oninput={(event) => queryInput(event.currentTarget.value)}
    use:focusOnMount
  />
  <select aria-label="Search scope" bind:value={$sessionPicker.scope} onchange={(event) => setSessionPickerScope(event.currentTarget.value)}>
    <option value="session">This session</option>
    <option value="folder">Folder…</option>
    <option value="all">All sessions</option>
  </select>
</form>

{#if isSearching && $sessionPicker.scope === "folder"}
  <div class="search-row">
    <select class="modal-flex-control" aria-label="Search folder" bind:value={$sessionPicker.folderPath} onchange={(event) => setSessionPickerFolder(event.currentTarget.value)}>
      {#each $sessionPicker.folders as folder (folder.dir)}
        <option value={folder.dir}>{abbreviateHomePath(folder.label)} ({folder.count})</option>
      {/each}
    </select>
  </div>
{/if}

{#if isSearching}
  <label class="search-opts">
    <input type="checkbox" bind:checked={$sessionPicker.excludeTools} onchange={(event) => setSessionPickerExcludeTools(event.currentTarget.checked)} />
    exclude tool output (search only user/ai text)
  </label>
  <div class="m-path" role="status" aria-atomic="true">{$sessionPicker.searchStatus}</div>
  {#each $sessionPicker.searchResults as group (group.sessionKey)}
    <button class="m-option search-hit" title={group.sessionKey} onclick={(event) => openSearchResult(event, group)}>
      <div class="s-title">
        <span class="s-name">{searchResultName(group)}</span>
        <span class="s-date">{searchGroupMeta(group)}</span>
      </div>
      {#each group.hits.slice(0, 3) as hit, index (hit.entryId ?? `${hit.role}:${hit.timestamp}:${hit.snippet.match}`)}
        <div class="s-snippet" data-hit-index={index}>
          <SearchHitSnippet role={hit.role} kind={hit.kind} snippet={hit.snippet} query={$sessionPicker.query} />
        </div>
      {/each}
      {#if group.hits.length > 3}
        <div class="s-snippet">…and {group.hits.length - 3} more in this session</div>
      {/if}
    </button>
  {/each}
{:else}
  {#if currentFamilies.active.length || activeOtherFolders.length}
    {@render SessionSection({ title: "Active sessions" })}
    {#if currentFamilies.active.length}
      {@render FolderLabel({ label: labelFor($sessionPicker.currentFolder) })}
      {@render SessionRows({ families: currentFamilies.active })}
    {/if}
    {#each activeOtherFolders as folder (folder.dir)}
      {@render FolderLabel({ label: labelFor(folder.dir) })}
      {@render SessionRows({ families: folder.families })}
    {/each}
  {/if}

  {#if currentFamilies.inactive.length || otherFolders.length}
    {@render SessionSection({ title: "Inactive sessions" })}
  {/if}
  {#if currentFamilies.inactive.length}
    {@render FolderLabel({ label: labelFor($sessionPicker.currentFolder) })}
    {@render SessionRows({ families: currentFamilies.inactive })}
  {/if}
  {#if otherFolders.length}
    <details class="s-folders">
      <summary>Other folders ({otherFolders.length})</summary>
      {#each otherFolders as folder (folder.dir)}
        <details class="s-folder" ontoggle={(event) => { if (event.currentTarget.open) loadPickedSessionFolder(folder); }}>
          <summary><FolderIcon size={13} /> {abbreviateHomePath(folder.label)} ({folder.count})</summary>
          {#if $sessionPicker.loadingFolders[folder.dir]}
            <div class="m-path" role="status"><span class="spin" aria-hidden="true"></span> loading sessions…</div>
          {:else if $sessionPicker.otherFolderSessions[folder.dir]}
            {@const inactiveFamilies = inactiveOtherFolderFamilies.get(folder.dir) ?? []}
            {#if inactiveFamilies.length}
              {@render SessionRows({ families: inactiveFamilies })}
            {:else}
              <div class="m-path">(no inactive sessions)</div>
            {/if}
          {/if}
        </details>
      {/each}
    </details>
  {/if}
{/if}

{#snippet sessionRow(session, timelineStatus = null)}
  {@const current = session.id === $sessionPicker.currentId}
  {@const alive = isAlive(session)}
  {@const busy = isBusy(session)}
  <div class={sessionRowClass(current, timelineStatus)}>
    <button class="s-session-main" onclick={() => choosePickedSession(sessionIdentity(session))}>
      <div class="s-title">
        {#if !timelineStatus}<span class={sessionDotClass(alive, busy)} title={sessionDotTitle(alive, busy)}></span>{/if}
        <span class="s-name">{sessionName(session)}{#if current} · current{/if}</span>
        <span class="s-date">{sessionDateMeta(session)}</span>
      </div>
      {#if session.name && session.preview}
        <div class="s-preview">{session.preview}</div>
      {/if}
    </button>
    {#if alive}
      <button class="s-del s-stop" title="Stop this session's process (keeps the session)" aria-label="Stop this session's process" onclick={() => stopPickedSession(session)}>■</button>
    {/if}
    {#if !current}
      <button class="s-del" title="Delete session" aria-label="Delete session" onclick={() => deletePickedSession(session)}>✕</button>
    {/if}
  </div>
{/snippet}

{#snippet SessionRows({ families })}
  {#each families as family (sessionIdentity(family.session))}
    {#if family.loop}
      {@const summary = loopFamilySummary(family)}
      <details
        class={`s-loopgroup status-${summary.status}`}
        open={childSessionsOpen(family)}
        ontoggle={(event) => setChildSessionsOpen(family, event.currentTarget.open)}
      >
        <summary>
          <span class="s-loop-icon" aria-hidden="true">↻</span>
          <span class="s-loop-copy">
            <span class="s-loop-kicker">Sequential loop · {family.forks.length} {plural(family.forks.length, "iteration")}</span>
            <strong>{sessionName(family.session, "Loop run")}</strong>
          </span>
          <span class={`s-loop-status status-${summary.status}`}>{summary.label}</span>
          <span class="s-loop-chevron" aria-hidden="true"></span>
        </summary>
        <div class="s-loop-timeline">
          {#each family.forks as fork (sessionIdentity(fork))}
            {@render sessionRow(fork, loopSessionStatus(fork))}
          {/each}
        </div>
      </details>
    {:else}
      {@render sessionRow(family.session)}
      {#if family.forks.length}
        <details
          class="s-forkgroup"
          open={childSessionsOpen(family)}
          ontoggle={(event) => setChildSessionsOpen(family, event.currentTarget.open)}
        >
          <summary>{family.forks.length} child {plural(family.forks.length, "session")}</summary>
          {#each family.forks as fork (sessionIdentity(fork))}
            {@render sessionRow(fork)}
          {/each}
        </details>
      {/if}
    {/if}
  {/each}
{/snippet}

{#snippet SessionSection({ title })}
  <div class="s-section">{title}</div>
{/snippet}

{#snippet FolderLabel({ label })}
  <div class="s-wd"><FolderIcon size={13} /> {label}</div>
{/snippet}

<div class="m-actions" id="mActions">
  <button class="chip" data-modal-cancel onclick={cancelSessionPicker}>Cancel</button>
</div>
