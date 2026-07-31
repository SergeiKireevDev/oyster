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
  import { incrementalCollectionPage, nextCollectionPageCount } from "../lib/incrementalCollection.js";
  import { isHubRuntime } from "../runtime/workspaceScope.js";

  const uiActions = getUiActionRegistry();
  const hubMode = isHubRuntime();
  const choosePickedSession = (...args) => uiActions.invoke(SESSION_PICKER_CHOOSE_ACTION, ...args);
  const deletePickedSession = (...args) => uiActions.invoke(SESSION_PICKER_DELETE_ACTION, ...args);
  const loadPickedSessionFolder = (...args) => uiActions.invoke(SESSION_PICKER_LOAD_FOLDER_ACTION, ...args);
  const openPickedSearchHit = (...args) => uiActions.invoke(SESSION_PICKER_OPEN_SEARCH_HIT_ACTION, ...args);
  const runSessionPickerSearch = () => uiActions.invoke(SESSION_PICKER_SEARCH_ACTION);
  const setSessionPickerExcludeTools = (...args) => {
    prepareSearchOptionChange();
    return uiActions.invoke(SESSION_PICKER_SET_EXCLUDE_TOOLS_ACTION, ...args);
  };
  const setSessionPickerFolder = (...args) => {
    prepareSearchOptionChange();
    return uiActions.invoke(SESSION_PICKER_SET_FOLDER_ACTION, ...args);
  };
  const setSessionPickerScope = (...args) => {
    prepareSearchOptionChange();
    return uiActions.invoke(SESSION_PICKER_SET_SCOPE_ACTION, ...args);
  };
  const stopPickedSession = (...args) => uiActions.invoke(SESSION_PICKER_STOP_ACTION, ...args);
  const cancelSessionPicker = () => uiActions.invoke(SESSION_PICKER_CANCEL_ACTION);

  const SEARCH_QUERY_MIN_LENGTH = 3;
  const SEARCH_PAGE_SIZE = 20;
  const SESSION_PAGE_SIZE = 40;
  const LOOP_COMPLETION_STATUSES = new Set(["succeeded", "failed"]);

  const isSearching = $derived($sessionPicker.query.trim().length >= SEARCH_QUERY_MIN_LENGTH);
  const runnerByIdentity = $derived(new Map(
    $sessionPicker.runners.map((runner) => [runnerSessionIdentity(runner), runner]),
  ));

  function folderOf(path) {
    const normalizedPath = String(path ?? "");
    const separatorIndex = normalizedPath.lastIndexOf("/");
    if (separatorIndex < 0) return "";
    return separatorIndex === 0 ? "/" : normalizedPath.slice(0, separatorIndex);
  }

  function labelFor(dir) {
    const folderLabel = $sessionPicker.folders.find((folder) => folder.dir === dir)?.label;
    const currentFolderLabel = dir === $sessionPicker.currentFolder
      ? $sessionPicker.currentWorkdir
      : dir;
    return abbreviateHomePath(folderLabel ?? currentFolderLabel ?? "?");
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
    if (LOOP_COMPLETION_STATUSES.has(runner?.subagentStatus)) return runner.subagentStatus;
    return "succeeded";
  }

  function loopFamilySummary(family) {
    let running = 0;
    let failed = 0;
    for (const fork of family.forks) {
      const status = loopSessionStatus(fork);
      if (status === "running") running += 1;
      else if (status === "failed") failed += 1;
    }
    const total = family.forks.length;
    const complete = total - running;
    if (running) return { status: "running", label: `${complete}/${total} complete · running` };
    if (failed) return { status: "failed", label: `${failed} failed · ${complete}/${total} complete` };
    return { status: "succeeded", label: `${complete}/${total} complete` };
  }

  function searchGroupMeta(group) {
    const workspace = hubMode && group.first.workspaceName ? `${group.first.workspaceName} · ` : "";
    const folder = $sessionPicker.scope === "all" ? `${abbreviateHomePath(group.first.folderLabel)} · ` : "";
    return `${workspace}${folder}${group.hits.length} hit${group.hits.length === 1 ? "" : "s"}`;
  }

  const sessionDotClass = (alive, busy) => `s-dot${busy ? " busy" : alive ? " on" : ""}`;
  const sessionDotTitle = (alive, busy) => busy ? "agent working" : alive ? "process running (idle)" : "no running process";
  const sessionDateMeta = (session) => `${hubMode && session.workspaceName ? `${session.workspaceName} · ` : ""}${formatRelativeTime(session.modifiedAt)} · ${session.messageCount} msgs`;
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
    const snippet = event.target instanceof Element
      ? event.target.closest(".s-snippet[data-hit-index]")
      : null;
    const index = Number(snippet?.dataset.hitIndex ?? 0);
    const hit = group.hits[index] ?? group.hits[0];
    if (hit) openPickedSearchHit(group.sessionKey, hit);
  }

  const currentPartition = $derived(partitionSessionFamilies($sessionPicker.sessions, isAlive));
  const currentFamilies = $derived({
    active: prepareSessionFamilies(currentPartition.active),
    inactive: prepareSessionFamilies(currentPartition.inactive),
  });
  const otherFolders = $derived(
    $sessionPicker.folders.filter((folder) => folder.dir !== $sessionPicker.currentFolder),
  );
  const activeOtherFolders = $derived.by(() => {
    const pathsByFolder = new Map();
    for (const runner of $sessionPicker.runners) {
      if (!runner.alive || !runner.sessionFile) continue;
      const dir = folderOf(runner.sessionFile);
      if (!dir || dir === $sessionPicker.currentFolder) continue;
      if (!pathsByFolder.has(dir)) pathsByFolder.set(dir, new Set());
      pathsByFolder.get(dir).add(runner.sessionFile);
    }
    return [...pathsByFolder].map(([dir, paths]) => ({
      dir,
      families: prepareSessionFamilies(
        ($sessionPicker.otherFolderSessions[dir] ?? []).filter((session) => paths.has(session.path)),
      ),
    }));
  });
  const inactiveOtherFolderFamilies = $derived(new Map(otherFolders.map((folder) => [
    folder.dir,
    prepareSessionFamilies(
      ($sessionPicker.otherFolderSessions[folder.dir] ?? []).filter((session) => !isAlive(session)),
    ),
  ])));

  let collectionLimits = $state(new Map());
  function collectionPage(items, limits, key, pageSize = SESSION_PAGE_SIZE) {
    return incrementalCollectionPage(items, limits.get(key), pageSize);
  }
  function revealCollectionPage(key, page) {
    const next = new Map(collectionLimits);
    next.set(key, nextCollectionPageCount(page.visibleCount, page.visibleCount + page.remainingCount, page.pageSize));
    collectionLimits = next;
  }

  let debounce = null;

  function focusOnMount(node) {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && node.isConnected) node.focus();
    });
    return { destroy: () => { cancelled = true; } };
  }

  function clearSearchTimer() {
    clearTimeout(debounce);
    debounce = null;
  }

  function resetSearchPage() {
    if (!collectionLimits.has("search")) return;
    const next = new Map(collectionLimits);
    next.delete("search");
    collectionLimits = next;
  }

  function prepareSearchOptionChange() {
    clearSearchTimer();
    resetSearchPage();
  }

  function queryInput(value) {
    prepareSearchOptionChange();
    const queryIsLongEnough = value.trim().length >= SEARCH_QUERY_MIN_LENGTH;
    updateSessionPicker({
      query: value,
      ...(!queryIsLongEnough ? { searchStatus: "", searchResults: [], searching: false } : {}),
    });
    if (!queryIsLongEnough) return;
    debounce = setTimeout(() => runSessionPickerSearch(), 250);
  }

  function submitSearch(event) {
    event.preventDefault();
    clearSearchTimer();
    runSessionPickerSearch();
  }

  onDestroy(() => clearTimeout(debounce));
</script>

<form class="search-row" role="search" onsubmit={submitSearch}>
  <input
    type="search"
    aria-label="Search sessions"
    placeholder="search sessions…"
    value={$sessionPicker.query}
    oninput={(event) => queryInput(event.currentTarget.value)}
    use:focusOnMount
  />
  <select aria-label="Search scope" value={$sessionPicker.scope} onchange={(event) => setSessionPickerScope(event.currentTarget.value)}>
    <option value="session">This session</option>
    <option value="folder">Folder…</option>
    <option value="all">All sessions</option>
  </select>
</form>

{#if isSearching && $sessionPicker.scope === "folder"}
  <div class="search-row">
    <select class="modal-flex-control" aria-label="Search folder" value={$sessionPicker.folderPath} onchange={(event) => setSessionPickerFolder(event.currentTarget.value)}>
      {#each $sessionPicker.folders as folder (folder.dir)}
        <option value={folder.dir}>{abbreviateHomePath(folder.label)} ({folder.count})</option>
      {/each}
    </select>
  </div>
{/if}

{#if isSearching}
  <label class="search-opts">
    <input type="checkbox" checked={$sessionPicker.excludeTools} onchange={(event) => setSessionPickerExcludeTools(event.currentTarget.checked)} />
    exclude tool output (search only user/ai text)
  </label>
  <div class="m-path" role="status" aria-atomic="true" aria-busy={$sessionPicker.searching}>{$sessionPicker.searchStatus}</div>
  {@const searchPage = collectionPage($sessionPicker.searchResults, collectionLimits, "search", SEARCH_PAGE_SIZE)}
  {#each searchPage.items as group (group.sessionKey)}
    <button type="button" class="m-option search-hit" title={group.sessionKey} onclick={(event) => openSearchResult(event, group)}>
      <div class="s-title">
        <span class="s-name">{searchResultName(group)}</span>
        <span class="s-date">{searchGroupMeta(group)}</span>
      </div>
      {#each group.hits.slice(0, 3) as hit, index (hit.entryId ?? hit)}
        <div class="s-snippet" data-hit-index={index}>
          <SearchHitSnippet role={hit.role} kind={hit.kind} snippet={hit.snippet} query={$sessionPicker.query} />
        </div>
      {/each}
      {#if group.hits.length > 3}
        <div class="s-snippet">…and {group.hits.length - 3} more in this session</div>
      {/if}
    </button>
  {/each}
  {#if searchPage.remainingCount}
    <button type="button" class="collection-load-more" onclick={() => revealCollectionPage("search", searchPage)}>Show {Math.min(SEARCH_PAGE_SIZE, searchPage.remainingCount)} more matching sessions</button>
  {/if}
{:else}
  {#if currentFamilies.active.length || activeOtherFolders.length}
    {@render SessionSection({ title: "Active sessions" })}
    {#if currentFamilies.active.length}
      {@render FolderLabel({ label: labelFor($sessionPicker.currentFolder) })}
      {@render SessionRows({ families: currentFamilies.active, listKey: "active:current" })}
    {/if}
    {#each activeOtherFolders as folder (folder.dir)}
      {@render FolderLabel({ label: labelFor(folder.dir) })}
      {@render SessionRows({ families: folder.families, listKey: `active:${folder.dir}` })}
    {/each}
  {/if}

  {#if currentFamilies.inactive.length || otherFolders.length}
    {@render SessionSection({ title: "Inactive sessions" })}
  {/if}
  {#if currentFamilies.inactive.length}
    {@render FolderLabel({ label: labelFor($sessionPicker.currentFolder) })}
    {@render SessionRows({ families: currentFamilies.inactive, listKey: "inactive:current" })}
  {/if}
  {#if otherFolders.length}
    <details class="s-folders">
      <summary>Other folders ({otherFolders.length})</summary>
      {#each otherFolders as folder (folder.dir)}
        <details class="s-folder" ontoggle={(event) => { if (event.currentTarget.open) loadPickedSessionFolder(folder); }}>
          <summary><FolderIcon size={13} /> {abbreviateHomePath(folder.label)} ({folder.count})</summary>
          {#if $sessionPicker.loadingFolders[folder.dir]}
            <div class="m-path" role="status" aria-atomic="true"><span class="spin" aria-hidden="true"></span> loading sessions…</div>
          {:else if $sessionPicker.otherFolderSessions[folder.dir]}
            {@const inactiveFamilies = inactiveOtherFolderFamilies.get(folder.dir) ?? []}
            {#if inactiveFamilies.length}
              {@render SessionRows({ families: inactiveFamilies, listKey: `inactive:${folder.dir}` })}
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
    <button type="button" class="s-session-main" onclick={() => choosePickedSession(sessionIdentity(session))}>
      <div class="s-title">
        {#if !timelineStatus}<span class={sessionDotClass(alive, busy)} role="img" aria-label={sessionDotTitle(alive, busy)} title={sessionDotTitle(alive, busy)}></span>{/if}
        <span class="s-name">{sessionName(session)}{#if current} · current{/if}</span>
        <span class="s-date">{sessionDateMeta(session)}</span>
      </div>
      {#if session.name && session.preview}
        <div class="s-preview">{session.preview}</div>
      {/if}
    </button>
    {#if alive}
      <button type="button" class="s-del s-stop" title="Stop this session's process (keeps the session)" aria-label="Stop this session's process" onclick={() => stopPickedSession(session)}>■</button>
    {/if}
    {#if !current}
      <button type="button" class="s-del" title="Delete session" aria-label="Delete session" onclick={() => deletePickedSession(session)}>✕</button>
    {/if}
  </div>
{/snippet}

{#snippet SessionRows({ families, listKey })}
  {@const familyPage = collectionPage(families, collectionLimits, `families:${listKey}`)}
  {#each familyPage.items as family (sessionIdentity(family.session))}
    {#if family.loop}
      {@const summary = loopFamilySummary(family)}
      {@const forkPage = collectionPage(family.forks, collectionLimits, `forks:${sessionIdentity(family.session)}`)}
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
          {#each forkPage.items as fork (sessionIdentity(fork))}
            {@render sessionRow(fork, loopSessionStatus(fork))}
          {/each}
          {#if forkPage.remainingCount}
            <button type="button" class="collection-load-more" onclick={() => revealCollectionPage(`forks:${sessionIdentity(family.session)}`, forkPage)}>Show {Math.min(SESSION_PAGE_SIZE, forkPage.remainingCount)} more iterations</button>
          {/if}
        </div>
      </details>
    {:else}
      {@render sessionRow(family.session)}
      {#if family.forks.length}
        {@const forkPage = collectionPage(family.forks, collectionLimits, `forks:${sessionIdentity(family.session)}`)}
        <details
          class="s-forkgroup"
          open={childSessionsOpen(family)}
          ontoggle={(event) => setChildSessionsOpen(family, event.currentTarget.open)}
        >
          <summary>{family.forks.length} child {plural(family.forks.length, "session")}</summary>
          {#each forkPage.items as fork (sessionIdentity(fork))}
            {@render sessionRow(fork)}
          {/each}
          {#if forkPage.remainingCount}
            <button type="button" class="collection-load-more" onclick={() => revealCollectionPage(`forks:${sessionIdentity(family.session)}`, forkPage)}>Show {Math.min(SESSION_PAGE_SIZE, forkPage.remainingCount)} more child sessions</button>
          {/if}
        </details>
      {/if}
    {/if}
  {/each}
  {#if familyPage.remainingCount}
    <button type="button" class="collection-load-more" onclick={() => revealCollectionPage(`families:${listKey}`, familyPage)}>Show {Math.min(SESSION_PAGE_SIZE, familyPage.remainingCount)} more sessions</button>
  {/if}
{/snippet}

{#snippet SessionSection({ title })}
  <div class="s-section" role="heading" aria-level="2">{title}</div>
{/snippet}

{#snippet FolderLabel({ label })}
  <div class="s-wd" role="heading" aria-level="3"><FolderIcon size={13} /> {label}</div>
{/snippet}

<div class="m-actions" id="mActions">
  <button type="button" class="chip" data-modal-cancel onclick={cancelSessionPicker}>Cancel</button>
</div>
