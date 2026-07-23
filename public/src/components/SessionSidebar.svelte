<script>
  import { onDestroy, onMount } from "svelte";
  import { appSession } from "../stores/appSession.js";
  import { sessionPicker, updateSessionPicker } from "../stores/sessionPicker.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { runnerSessionIdentity, sameSession, sessionIdentity } from "../lib/sessionIdentity.js";
  import { formatRelativeTime } from "../lib/relativeTime.js";
  import { isHubRuntime, listEnvironments, listOnlineWorkspaces, setActiveWorkspace } from "../runtime/workspaceScope.js";
  import { groupSessionCwdsByHierarchy, groupSessionSearchByHierarchy, groupSessionsByCwd, partitionSessionGroupsByArchive } from "../features/sessions/sessionPickerViewModel.js";
  import {
    SESSION_PICKER_ARCHIVE_ACTION,
    SESSION_PICKER_CHOOSE_ACTION,
    SESSION_PICKER_DELETE_ACTION,
    SESSION_PICKER_OPEN_SEARCH_HIT_ACTION,
    SESSION_PICKER_SEARCH_ACTION,
    SESSION_PICKER_SET_SCOPE_ACTION,
    SESSION_PICKER_STOP_ACTION,
    SESSION_SIDEBAR_CREATE_IN_FOLDER_ACTION,
    SESSION_SIDEBAR_REFRESH_ACTION,
    SESSION_SWITCH_RUNNER_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const runtimeConfig = globalThis.__OYSTER_RUNTIME_CONFIG__ ?? {};
  const hubMode = isHubRuntime(runtimeConfig);
  const hierarchyDefaults = {
    environmentId: runtimeConfig.environment?.id || "local-device",
    environmentName: runtimeConfig.environment?.name || (hubMode ? "Hub environment" : "Local device"),
    workspaceId: runtimeConfig.workspace?.id || "local-workspace",
    workspaceName: runtimeConfig.workspace?.name || (hubMode ? "Workspace" : "This workspace"),
  };
  const switchRunner = (id) => {
    const runner = $appSession.runners.find((candidate) => candidate.id === id);
    if (runner?.environmentId) selectedEnvironmentId = runner.environmentId;
    setActiveWorkspace(runner?.workspaceId);
    return uiActions.invoke(SESSION_SWITCH_RUNNER_ACTION, id);
  };
  const openSavedSession = (session) => {
    if (session?.environmentId) selectedEnvironmentId = session.environmentId;
    setActiveWorkspace(session?.workspaceId);
    return uiActions.invoke(SESSION_PICKER_CHOOSE_ACTION, sessionIdentity(session));
  };
  const refreshSessions = () => uiActions.invoke(SESSION_SIDEBAR_REFRESH_ACTION);
  const createSessionInFolder = (workspace = null) => uiActions.invoke(SESSION_SIDEBAR_CREATE_IN_FOLDER_ACTION, workspace);
  const openSearchHit = (group, hit) => uiActions.invoke(SESSION_PICKER_OPEN_SEARCH_HIT_ACTION, group.sessionKey, hit);
  const stopSession = (runner) => uiActions.invoke(SESSION_PICKER_STOP_ACTION, savedSession(runner) ?? runner);
  const archiveSession = (session) => uiActions.invoke(SESSION_PICKER_ARCHIVE_ACTION, session);
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
  let availableEnvironments = [];
  let availableWorkspaces = [];
  let availableWorkspacesLoaded = !hubMode;
  onMount(async () => {
    if (!hubMode) return;
    try {
      [availableEnvironments, availableWorkspaces] = await Promise.all([
        listEnvironments(),
        listOnlineWorkspaces(),
      ]);
      availableWorkspacesLoaded = true;
    } catch {
      // Keep session-derived environment options when discovery is temporarily unavailable.
    }
  });

  let clock = Date.now();
  const clockTimer = setInterval(() => { clock = Date.now(); }, 60_000);
  onDestroy(() => {
    clearTimeout(searchTimer);
    clearInterval(clockTimer);
  });

  let selectedEnvironmentId = null;
  $: searching = $sessionPicker.query.trim().length >= 2;
  $: searchEnvironments = groupSessionSearchByHierarchy($sessionPicker.searchResults, hierarchyDefaults);
  $: sidebarRunners = $appSession.runners.filter((runner) => runner.sessionId);
  $: currentRunner = $appSession.runners.find((runner) => runner.id === $appSession.currentRunner);
  $: currentCwd = currentRunner?.dir ?? null;
  $: sessionGroups = partitionSessionGroupsByArchive(
    groupSessionsByCwd($sessionPicker.allSessions, sidebarRunners),
  );
  $: sessionEnvironments = groupSessionCwdsByHierarchy(sessionGroups, hierarchyDefaults);
  $: sessionEnvironmentsForView = !hubMode && !sessionEnvironments.length
    ? [{
        environmentId: hierarchyDefaults.environmentId,
        environmentName: hierarchyDefaults.environmentName,
        workspaces: [{
          workspaceId: hierarchyDefaults.workspaceId,
          workspaceName: hierarchyDefaults.workspaceName,
          recentGroups: [],
          archivedGroups: [],
          archivedCount: 0,
        }],
      }]
    : sessionEnvironments;
  $: discoveredEnvironmentOptions = environmentOptionsFromCatalog(availableEnvironments);
  $: environmentOptions = hubMode && availableWorkspacesLoaded
    ? discoveredEnvironmentOptions
    : mergeEnvironmentOptions(sessionEnvironmentsForView, searchEnvironments);
  $: if (environmentOptions.length && !environmentOptions.some((environment) => environment.environmentId === selectedEnvironmentId)) {
    selectedEnvironmentId = preferredEnvironmentId(environmentOptions);
  }
  $: availableWorkspaceIds = hubMode && availableWorkspacesLoaded
    ? new Set(availableWorkspaces
      .filter((workspace) => workspace.environmentId === selectedEnvironmentId)
      .map((workspace) => workspace.id))
    : null;
  $: visibleSessionEnvironments = availableWorkspaceIds
    ? availableEnvironmentView(sessionEnvironmentsForView, selectedEnvironmentId, availableWorkspaces)
    : filterEnvironmentWorkspaces(sessionEnvironmentsForView, selectedEnvironmentId, null);
  $: visibleSearchEnvironments = filterEnvironmentWorkspaces(searchEnvironments, selectedEnvironmentId, availableWorkspaceIds);
  let expandedCwds = new Set();
  let initializedCwdExpansion = false;
  $: if (!initializedCwdExpansion && currentCwd) {
    initializedCwdExpansion = true;
    expandedCwds = new Set([cwdExpansionKey({
      cwd: currentCwd,
      environmentId: currentRunner?.environmentId,
      workspaceId: currentRunner?.workspaceId,
      archived: false,
    })]);
  }
  function environmentOptionsFromCatalog(environments) {
    return environments.map((environment) => ({
      environmentId: environment.id,
      environmentName: environment.name || environment.id,
      status: environment.status || "unknown",
      local: Boolean(environment.local) || isLocalEnvironment(environment.id, environment.name),
    }));
  }
  function availableEnvironmentView(environments, environmentId, workspaces) {
    const available = workspaces.filter((workspace) => workspace.environmentId === environmentId);
    if (!available.length) return [];
    const existing = environments.find((environment) => environment.environmentId === environmentId);
    return [{
      environmentId,
      environmentName: available[0].environmentName || environmentId,
      workspaces: available.map((workspace) => existing?.workspaces.find((candidate) => candidate.workspaceId === workspace.id) ?? {
        workspaceId: workspace.id,
        workspaceName: workspace.name || workspace.id,
        recentGroups: [],
        archivedGroups: [],
        archivedCount: 0,
      }),
    }];
  }
  function isLocalEnvironment(environmentId, environmentName) {
    return [environmentId, environmentName].some((value) => /^(local|local-device)(?:\b|$)/i.test(String(value ?? "")));
  }
  function preferredEnvironmentId(options) {
    return options.find((environment) => isLocalEnvironment(environment.environmentId, environment.environmentName))?.environmentId
      ?? options.find((environment) => environment.local)?.environmentId
      ?? options[0]?.environmentId
      ?? null;
  }
  function filterEnvironmentWorkspaces(environments, environmentId, workspaceIds) {
    return environments
      .filter((environment) => environment.environmentId === environmentId)
      .map((environment) => ({
        ...environment,
        workspaces: workspaceIds
          ? environment.workspaces.filter((workspace) => workspaceIds.has(workspace.workspaceId))
          : environment.workspaces,
      }))
      .filter((environment) => environment.workspaces.length);
  }
  function mergeEnvironmentOptions(primary, secondary) {
    const options = new Map();
    for (const environment of [...primary, ...secondary]) {
      if (!options.has(environment.environmentId)) options.set(environment.environmentId, {
        environmentId: environment.environmentId,
        environmentName: environment.environmentName,
        local: isLocalEnvironment(environment.environmentId, environment.environmentName),
      });
    }
    return [...options.values()];
  }
  function isCurrentWorkspace(environment, workspace) {
    if (!currentRunner) return false;
    return environment.environmentId === (currentRunner.environmentId || hierarchyDefaults.environmentId)
      && workspace.workspaceId === (currentRunner.workspaceId || hierarchyDefaults.workspaceId);
  }
  function isCurrentCwd(group) {
    if (!currentRunner || group.cwd !== currentCwd) return false;
    return (group.environmentId || hierarchyDefaults.environmentId) === (currentRunner.environmentId || hierarchyDefaults.environmentId)
      && (group.workspaceId || hierarchyDefaults.workspaceId) === (currentRunner.workspaceId || hierarchyDefaults.workspaceId);
  }
  function cwdExpansionKey(group) {
    return `${group.archived ? "archived" : "recent"}:${group.environmentId ?? hierarchyDefaults.environmentId}:${group.workspaceId ?? hierarchyDefaults.workspaceId}:${group.cwd}`;
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

{#snippet SessionRows({ entries, archived = false, cwd = "" })}
  <div class="session-sidebar-workspace-sessions">
    {#each entries as entry (entry.session ? sessionIdentity(entry.session) : entry.runner.id)}
      {@const session = entry.session}
      {@const runner = entry.runner}
      {@const current = runner?.id === $appSession.currentRunner || (!runner && session?.id === $sessionPicker.currentId)}
      <div class="session-sidebar-entry" class:current>
        <button
          type="button"
          class:busy={runner?.busy}
          class="session-sidebar-row"
          title={`${label(session, runner)}\n${cwd}`}
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
        {:else if archived && !current}
          <button type="button" class="session-sidebar-action delete" title="Delete archived session" aria-label="Delete archived session" onclick={() => deleteSession(session ?? runner)}>✕</button>
        {:else if !archived && session}
          <button
            type="button"
            class="session-sidebar-lifecycle archive"
            title="Archive session"
            aria-label="Archive session"
            onclick={() => archiveSession(session)}
          ></button>
        {/if}
      </div>
    {/each}
  </div>
{/snippet}

{#snippet CwdCategory({ group, archived = false })}
  <details
    class="session-sidebar-cwd"
    class:current-cwd={isCurrentCwd(group)}
    open={expandedCwds.has(cwdExpansionKey(group))}
    ontoggle={(event) => setCwdExpanded(cwdExpansionKey(group), event.currentTarget.open)}
  >
    <summary title={group.cwd}>
      <span class="session-sidebar-cwd-icon" aria-hidden="true"></span>
      <span class="session-sidebar-cwd-label">{group.cwd}</span>
      <span class="session-sidebar-count">{group.entries.length}</span>
    </summary>
    {@render SessionRows({ entries: group.entries, archived, cwd: group.cwd })}
  </details>
{/snippet}

{#snippet WorkspaceHeading(workspace)}
  <div class="session-sidebar-workspace-heading">
    <span class="session-sidebar-workspace-icon" aria-hidden="true"></span>
    <span class="session-sidebar-hierarchy-copy">
      <small>Workspace</small>
      <strong>{workspace.workspaceName}</strong>
    </span>
    {#if workspace.workspaceId !== workspace.workspaceName}<code>{workspace.workspaceId}</code>{/if}
    <button
      type="button"
      class="session-sidebar-workspace-create"
      title={`New session in ${workspace.workspaceName}`}
      aria-label={`New session in ${workspace.workspaceName}`}
      onclick={() => createSessionInFolder(hubMode ? { id: workspace.workspaceId, name: workspace.workspaceName } : null)}
    >+</button>
  </div>
{/snippet}

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
  {#if environmentOptions.length}
    <label class="session-sidebar-environment-selector">
      <span class="session-sidebar-environment-tab-icon" aria-hidden="true"></span>
      <span class="session-sidebar-environment-label">Environment</span>
      <select
        aria-label="Environment"
        value={selectedEnvironmentId}
        onchange={(event) => { selectedEnvironmentId = event.currentTarget.value; }}
      >
        {#each environmentOptions as environment (environment.environmentId)}
          <option value={environment.environmentId} disabled={environment.status === "offline"}>
            {environment.environmentName}{environment.status === "offline" ? " · offline" : ""}
          </option>
        {/each}
      </select>
    </label>
  {/if}
  <div class="session-sidebar-list">
    {#if hubMode && availableWorkspacesLoaded && !environmentOptions.length}
      <div class="r-empty">(no available environments)</div>
    {:else if searching}
      {#if $sessionPicker.searchStatus}<div class="session-sidebar-status">{$sessionPicker.searchStatus}</div>{/if}
      {#each visibleSearchEnvironments as environment (environment.environmentId)}
        <section class="session-sidebar-environment-view">
          {#each environment.workspaces as workspace (workspace.workspaceId)}
            <section
              class="session-sidebar-workspace-container"
              class:current-workspace={isCurrentWorkspace(environment, workspace)}
            >
              {@render WorkspaceHeading(workspace)}
              {#each workspace.groups as group (group.sessionKey)}
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
            </section>
          {/each}
        </section>
      {/each}
    {:else if visibleSessionEnvironments.length}
      {#each visibleSessionEnvironments as environment (environment.environmentId)}
        <section class="session-sidebar-environment-view">
          {#each environment.workspaces as workspace (workspace.workspaceId)}
            <section
              class="session-sidebar-workspace-container"
              class:current-workspace={isCurrentWorkspace(environment, workspace)}
            >
              {@render WorkspaceHeading(workspace)}
              {#each workspace.recentGroups as group (`recent:${group.cwd}`)}
                {@render CwdCategory({ group })}
              {/each}
              {#if !workspace.recentGroups.length && !workspace.archivedGroups.length}
                <div class="session-sidebar-workspace-empty">(no sessions)</div>
              {/if}
              {#if workspace.archivedGroups.length}
                <details class="session-sidebar-archive">
                  <summary class="session-archive-divider" title="Manually archived or head older than 2 days">
                    <span>Archived</span>
                    <small>{workspace.archivedCount} session{workspace.archivedCount === 1 ? "" : "s"}</small>
                  </summary>
                  <div class="session-sidebar-archive-groups">
                    {#each workspace.archivedGroups as group (`archived:${group.cwd}`)}
                      {@render CwdCategory({ group, archived: true })}
                    {/each}
                  </div>
                </details>
              {/if}
            </section>
          {/each}
        </section>
      {/each}
    {:else}
      <div class="r-empty">(no active sessions)</div>
    {/if}
  </div>
</aside>
