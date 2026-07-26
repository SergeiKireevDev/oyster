<script>
  import { onDestroy, onMount } from "svelte";
  import { appSession } from "../stores/appSession.js";
  import { sessionPicker, updateSessionPicker } from "../stores/sessionPicker.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { runnerSessionIdentity, sameSession, sessionIdentity } from "../lib/sessionIdentity.js";
  import { formatRelativeTime } from "../lib/relativeTime.js";
  import { abbreviateHomePath } from "../lib/pathDisplay.js";
  import { effectiveWorkspaceStatus, isHubRuntime, listEnvironments, listWorkspaces, setActiveWorkspace } from "../runtime/workspaceScope.js";
  import { openModal } from "../stores/modal.js";
  import { workspaceChanges } from "../stores/workspaces.js";
  import { cloudBrowser } from "../features/cloud/cloudBrowser.js";
  import { groupSessionCwdsByHierarchy, groupSessionSearchByHierarchy, groupSessionsByCwd, partitionSessionGroupsByArchive } from "../features/sessions/sessionPickerViewModel.js";
  import {
    SESSION_PICKER_ARCHIVE_ACTION,
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
  const runtimeConfig = globalThis.__OYSTER_RUNTIME_CONFIG__ ?? {};
  const hubMode = isHubRuntime(runtimeConfig);
  const hierarchyDefaults = {
    environmentId: runtimeConfig.environment?.id || "local",
    environmentName: runtimeConfig.environment?.name || "Environment",
    workspaceId: runtimeConfig.workspace?.id || "local",
    workspaceName: runtimeConfig.workspace?.name || "Workspace",
  };
  const switchRunner = (id) => {
    const runner = $appSession.runners.find((candidate) => candidate.id === id);
    if (hubMode) {
      if (runner?.environmentId) selectedEnvironmentId = runner.environmentId;
      setActiveWorkspace(runner?.workspaceId);
    }
    return uiActions.invoke(SESSION_SWITCH_RUNNER_ACTION, id);
  };
  const openSavedSession = (session) => {
    if (hubMode) {
      if (session?.environmentId) selectedEnvironmentId = session.environmentId;
      setActiveWorkspace(session?.workspaceId);
    }
    return uiActions.invoke(SESSION_PICKER_CHOOSE_ACTION, sessionIdentity(session));
  };
  const refreshSessions = () => uiActions.invoke(SESSION_SIDEBAR_REFRESH_ACTION);
  const createSessionInCwd = (cwd) => uiActions.invoke(SESSION_SIDEBAR_CREATE_IN_CWD_ACTION, cwd);
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
  let environmentInfoOpen = false;
  let environmentInfoEnvironmentId = null;
  async function refreshEnvironmentCatalog(preferredId = null) {
    if (!hubMode) return;
    try {
      [availableEnvironments, availableWorkspaces] = await Promise.all([
        listEnvironments(),
        listWorkspaces(),
      ]);
      availableWorkspacesLoaded = true;
      if (preferredId) selectedEnvironmentId = preferredId;
    } catch {
      // Keep session-derived environment options when discovery is temporarily unavailable.
    }
  }
  function closeEnvironmentInfo() {
    environmentInfoOpen = false;
    environmentInfoEnvironmentId = null;
  }
  function dismissEnvironmentInfo(event) {
    event.stopPropagation();
    closeEnvironmentInfo();
  }
  function openWorkspaceProvisioning() {
    closeEnvironmentInfo();
    if (selectedEnvironment?.kind === "llmbox") {
      openModal({
        title: `New workspace in ${selectedEnvironment.environmentName}`,
        wide: true,
        content: "llmboxWorkspace",
        context: { spoke: selectedEnvironment.spoke || selectedEnvironment.environmentId, environmentName: selectedEnvironment.environmentName },
      });
      return;
    }
    openModal({
      title: selectedEnvironment?.kind === "cloud" ? `New workspace in ${selectedEnvironment.environmentName}` : "New cloud workspace",
      wide: true,
      content: "cloudWorkspace",
      context: { providerId: selectedEnvironment?.kind === "cloud" ? selectedEnvironment.provider?.id : "" },
    });
  }
  function chooseEnvironment(event) {
    selectedEnvironmentId = event.currentTarget.value;
    closeEnvironmentInfo();
  }
  function toggleEnvironmentInfo() {
    if (!selectedEnvironment) return;
    if (environmentInfoOpen) closeEnvironmentInfo();
    else {
      environmentInfoEnvironmentId = selectedEnvironment.environmentId;
      environmentInfoOpen = true;
    }
  }
  function handleEnvironmentInfoKeydown(event) {
    if (event.key === "Escape") closeEnvironmentInfo();
  }
  let workspaceActions = new Set();
  function cloudWorkspace(workspace) {
    return workspace.provider?.type === "cloud";
  }
  async function manageCloudWorkspace(workspace, action) {
    const verb = action === "destroy" ? "Destroy" : action === "resume" ? "Resume" : "Pause";
    const warning = action === "destroy"
      ? `Destroy “${workspace.workspaceName}” permanently?\n\nThe provider VM and its disk, sessions, and stored model credentials will be deleted. This cannot be undone.`
      : action === "pause"
        ? `Pause “${workspace.workspaceName}”?\n\nActive sessions will disconnect. The VM disk is retained; storage charges continue, and DigitalOcean may continue charging for the reserved Droplet.`
        : `Resume “${workspace.workspaceName}”?`;
    if (!confirm(warning)) return;
    workspaceActions = new Set([...workspaceActions, workspace.workspaceId]);
    try {
      const path = `/api/v1/workspaces/${encodeURIComponent(workspace.workspaceId)}${action === "destroy" ? "" : "/actions"}`;
      const response = await fetch(path, action === "destroy" ? { method: "DELETE" } : {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `${verb} failed (${response.status})`);
      if (action === "destroy" && currentRunner?.workspaceId === workspace.workspaceId) {
        const replacement = availableWorkspaces.find((candidate) => candidate.id !== workspace.workspaceId && effectiveWorkspaceStatus(candidate) === "online");
        if (replacement) setActiveWorkspace(replacement.id);
      }
      await refreshEnvironmentCatalog();
      refreshSessions();
    } catch (cause) {
      alert(`${verb} failed: ${cause.message}`);
    } finally {
      const next = new Set(workspaceActions);
      next.delete(workspace.workspaceId);
      workspaceActions = next;
    }
  }
  let environmentRefreshTimer = null;
  onMount(() => {
    refreshEnvironmentCatalog();
    environmentRefreshTimer = setInterval(refreshEnvironmentCatalog, 5_000);
    if (hubMode && cloudBrowser.hasConnectionReturn()) openWorkspaceProvisioning();
  });
  let workspaceRevision = 0;
  $: if ($workspaceChanges.revision > workspaceRevision) {
    workspaceRevision = $workspaceChanges.revision;
    refreshEnvironmentCatalog($workspaceChanges.workspace?.environmentId);
  }

  let clock = Date.now();
  const clockTimer = setInterval(() => { clock = Date.now(); }, 60_000);
  onDestroy(() => {
    clearTimeout(searchTimer);
    clearInterval(environmentRefreshTimer);
    clearInterval(clockTimer);
  });

  let selectedEnvironmentId = null;
  $: searching = $sessionPicker.query.trim().length >= 2;
  $: searchEnvironments = hubMode ? groupSessionSearchByHierarchy($sessionPicker.searchResults, hierarchyDefaults) : [];
  $: sidebarRunners = $appSession.runners.filter((runner) => runner.sessionId);
  $: currentRunner = $appSession.runners.find((runner) => runner.id === $appSession.currentRunner);
  $: currentCwd = currentRunner?.dir ?? null;
  $: sessionGroups = partitionSessionGroupsByArchive(
    groupSessionsByCwd($sessionPicker.allSessions, sidebarRunners),
  );
  $: spokeRecentGroups = hubMode ? [] : sessionGroups.filter((group) => !group.archived);
  $: spokeArchivedGroups = hubMode ? [] : sessionGroups.filter((group) => group.archived);
  $: spokeArchivedCount = spokeArchivedGroups.reduce((count, group) => count + group.entries.length, 0);
  $: sessionEnvironments = hubMode ? groupSessionCwdsByHierarchy(sessionGroups, hierarchyDefaults) : [];
  $: discoveredEnvironmentOptions = environmentOptionsFromCatalog(availableEnvironments);
  $: environmentOptions = !hubMode
    ? []
    : availableWorkspacesLoaded
      ? discoveredEnvironmentOptions
      : mergeEnvironmentOptions(sessionEnvironments, searchEnvironments);
  $: if (environmentOptions.length && !environmentOptions.some((environment) => environment.environmentId === selectedEnvironmentId)) {
    selectedEnvironmentId = preferredEnvironmentId(environmentOptions);
  }
  $: selectedEnvironment = environmentOptions.find((environment) => environment.environmentId === selectedEnvironmentId) ?? null;
  $: if (environmentInfoOpen && (!selectedEnvironment || selectedEnvironment.environmentId !== environmentInfoEnvironmentId)) closeEnvironmentInfo();
  $: selectedEnvironmentInfo = selectedEnvironment ? environmentInfo(selectedEnvironment) : [];
  $: availableWorkspaceIds = hubMode && availableWorkspacesLoaded
    ? new Set(availableWorkspaces
      .filter((workspace) => workspace.environmentId === selectedEnvironmentId)
      .map((workspace) => workspace.id))
    : null;
  $: visibleSessionEnvironments = availableWorkspaceIds
    ? availableEnvironmentView(sessionEnvironments, selectedEnvironmentId, availableWorkspaces)
    : filterEnvironmentWorkspaces(sessionEnvironments, selectedEnvironmentId, null);
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
      ...environment,
      environmentId: environment.id,
      environmentName: environment.name || environment.id,
      status: environment.status || "unknown",
      kind: environment.kind || (environment.cloud ? "cloud" : environment.local ? "local" : "unknown"),
      workspaceCount: availableWorkspaces.filter((workspace) => workspace.environmentId === environment.id).length,
      local: Boolean(environment.local) || isLocalEnvironment(environment.id, environment.name),
    }));
  }
  function displayInstanceValue(value) {
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.join(", ");
    if (value && typeof value === "object") return JSON.stringify(value);
    return String(value);
  }
  function environmentInfo(environment) {
    const provider = environment.provider ?? {};
    const type = environment.kind === "cloud" ? "Cloud provider"
      : environment.kind === "llmbox" ? "llmbox spoke"
        : environment.kind === "local" ? "Direct Hub connection" : environment.kind;
    const rows = [
      ["Environment ID", environment.id],
      ["Type", type],
      ["Status", statusLabel(environment.status)],
      ...(environment.kind === "cloud" ? [
        ["Provider", provider.name || provider.id],
        ["Connection", provider.configured ? "Connected" : "Disconnected"],
      ] : []),
      ...(environment.kind === "llmbox" ? [
        ["Spoke", environment.spoke || environment.id],
        ["Default", environment.default ? "Yes" : "No"],
      ] : []),
      ["Workspaces", environment.workspaceCount ?? 0],
    ];
    return rows
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([label, value]) => ({ label, value: displayInstanceValue(value), raw: String(value) }));
  }
  function availableEnvironmentView(environments, environmentId, workspaces) {
    const available = workspaces.filter((workspace) => workspace.environmentId === environmentId);
    if (!available.length) return [];
    const existing = environments.find((environment) => environment.environmentId === environmentId);
    return [{
      environmentId,
      environmentName: available[0].environmentName || environmentId,
      workspaces: available.map((workspace) => ({
        ...(existing?.workspaces.find((candidate) => candidate.workspaceId === workspace.id) ?? {
          workspaceId: workspace.id,
          workspaceName: workspace.name || workspace.id,
          recentGroups: [],
          archivedGroups: [],
          archivedCount: 0,
        }),
        status: effectiveWorkspaceStatus(workspace),
        provider: workspace.provider,
      })),
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
  function workspaceStatus(workspace) {
    const status = effectiveWorkspaceStatus(workspace);
    return ["online", "provisioning", "provisioned", "awaiting_agent", "initializing", "resuming", "paused", "pausing", "destroying", "offline", "failed"].includes(status) ? status : "unknown";
  }
  function statusLabel(status) {
    return ({
      online: "Online",
      provisioning: "Provisioning",
      provisioned: "Setup needed",
      awaiting_agent: "Awaiting agent",
      initializing: "Initializing",
      resuming: "Resuming",
      paused: "Paused",
      pausing: "Pausing",
      destroying: "Destroying",
      offline: "Offline",
      failed: "Failed",
      unknown: "Unknown",
    })[status] || "Unknown";
  }
  function environmentStatusLabel(status) {
    return status === "online" ? "" : ` · ${statusLabel(status)}`;
  }
  function isCurrentWorkspace(environment, workspace) {
    if (!currentRunner) return false;
    return environment.environmentId === (currentRunner.environmentId || hierarchyDefaults.environmentId)
      && workspace.workspaceId === (currentRunner.workspaceId || hierarchyDefaults.workspaceId);
  }
  function isCurrentCwd(group) {
    if (!currentRunner || group.cwd !== currentCwd) return false;
    if (!hubMode) return true;
    return (group.environmentId || hierarchyDefaults.environmentId) === (currentRunner.environmentId || hierarchyDefaults.environmentId)
      && (group.workspaceId || hierarchyDefaults.workspaceId) === (currentRunner.workspaceId || hierarchyDefaults.workspaceId);
  }
  function cwdExpansionKey(group) {
    const prefix = `${group.archived ? "archived" : "recent"}:`;
    return hubMode
      ? `${prefix}${group.environmentId ?? hierarchyDefaults.environmentId}:${group.workspaceId ?? hierarchyDefaults.workspaceId}:${group.cwd}`
      : `${prefix}${group.cwd}`;
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
          title={`${label(session, runner)}\n${abbreviateHomePath(cwd)}`}
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
      <span class="session-sidebar-cwd-label">{abbreviateHomePath(group.cwd)}</span>
      <span class="session-sidebar-count">{group.entries.length}</span>
    </summary>
    {@render SessionRows({ entries: group.entries, archived, cwd: group.cwd })}
  </details>
{/snippet}

{#snippet SearchGroups(groups)}
  {#each groups as group (group.sessionKey)}
    <section class="session-sidebar-hit-group" title={group.sessionKey}>
      <div class="session-sidebar-hit-heading">
        <span class="session-sidebar-name">{group.first.sessionName || group.first.sessionPreview || "(unnamed session)"}</span>
        <span class="session-sidebar-hit-count">{group.hits.length}</span>
      </div>
      <span
        class="session-sidebar-folder"
        title={group.first.sessionCwd || group.first.folderLabel || ""}
      >{abbreviateHomePath(group.first.sessionCwd || group.first.folderLabel) || "Unknown working directory"}</span>
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
{/snippet}

{#snippet WorkspaceHeading(workspace)}
  {@const status = workspaceStatus(workspace)}
  {@const online = status === "online"}
  {@const managing = workspaceActions.has(workspace.workspaceId)}
  <div class="session-sidebar-workspace-heading" class:workspace-unavailable={!online}>
    <span
      class={`session-sidebar-workspace-icon status-${status}`}
      role="img"
      aria-label={`Workspace status: ${statusLabel(status)}`}
      title={statusLabel(status)}
    ></span>
    <span class="session-sidebar-hierarchy-copy">
      <span class="session-sidebar-workspace-kicker">
        <small>Workspace</small>
        <span class={`session-sidebar-workspace-status status-${status}`}>{statusLabel(status)}</span>
      </span>
      <strong>{workspace.workspaceName}</strong>
    </span>
    {#if workspace.workspaceId !== workspace.workspaceName}<code>{workspace.workspaceId}</code>{/if}
    {#if cloudWorkspace(workspace)}
      <span class="session-sidebar-workspace-cloud-actions">
        <button
          type="button"
          class="session-sidebar-workspace-power"
          class:resume={status === "paused"}
          title={status === "paused" ? `Resume ${workspace.workspaceName}` : `Pause ${workspace.workspaceName}`}
          aria-label={status === "paused" ? `Resume ${workspace.workspaceName}` : `Pause ${workspace.workspaceName}`}
          disabled={managing || ["provisioning", "awaiting_agent", "initializing", "resuming", "pausing", "destroying"].includes(status)}
          onclick={() => manageCloudWorkspace(workspace, status === "paused" ? "resume" : "pause")}
        >{status === "paused" ? "▶" : "Ⅱ"}</button>
        <button
          type="button"
          class="session-sidebar-workspace-destroy"
          title={`Destroy ${workspace.workspaceName}`}
          aria-label={`Destroy ${workspace.workspaceName}`}
          disabled={managing || status === "destroying"}
          onclick={() => manageCloudWorkspace(workspace, "destroy")}
        >×</button>
      </span>
    {/if}
    <button
      type="button"
      class="session-sidebar-workspace-create"
      title={online ? `New session in ${workspace.workspaceName}` : `${workspace.workspaceName} is ${statusLabel(status).toLowerCase()}`}
      aria-label={`New session in ${workspace.workspaceName}`}
      disabled={!online}
      onclick={() => createSessionInFolder({ id: workspace.workspaceId, name: workspace.workspaceName })}
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
  {#if !hubMode && !searching}
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
          <small>{currentCwd ? `Current folder: ${abbreviateHomePath(currentCwd)}` : "Current folder unavailable"}</small>
        </span>
      </button>
      <button
        type="button"
        class="session-sidebar-create-folder"
        id="newSessionFolder"
        title="Choose another folder"
        aria-label="Choose another folder for a new session"
        onclick={() => createSessionInFolder()}
      ><span class="session-sidebar-create-chevron" aria-hidden="true"></span></button>
    </div>
  {/if}
  {#if hubMode && environmentOptions.length}
    <div class="session-sidebar-environment-picker">
      <div class="session-sidebar-environment-selector">
        <label class="session-sidebar-environment-control">
          <span class="session-sidebar-environment-tab-icon" aria-hidden="true"></span>
          <span class="session-sidebar-environment-label">Environment</span>
          <select
            aria-label="Environment"
            value={selectedEnvironmentId || ""}
            onchange={chooseEnvironment}
          >
            {#each environmentOptions as environment (environment.environmentId)}
              <option value={environment.environmentId}>
                {environment.environmentName}{environmentStatusLabel(environment.status)}
              </option>
            {/each}
          </select>
        </label>
        <button
          type="button"
          class="session-sidebar-environment-info"
          class:active={environmentInfoOpen}
          title={`Environment information for ${selectedEnvironment.environmentName}`}
          aria-label={`${environmentInfoOpen ? "Hide" : "Show"} environment information for ${selectedEnvironment.environmentName}`}
          aria-expanded={environmentInfoOpen}
          onclick={toggleEnvironmentInfo}
          onkeydown={handleEnvironmentInfoKeydown}
        >i</button>
        <button
          type="button"
          class="session-sidebar-environment-create"
          title={selectedEnvironment.kind === "llmbox" || selectedEnvironment.kind === "cloud" ? `New workspace in ${selectedEnvironment.environmentName}` : "Connect a cloud provider"}
          aria-label={selectedEnvironment.kind === "llmbox" || selectedEnvironment.kind === "cloud" ? `New workspace in ${selectedEnvironment.environmentName}` : "Connect a cloud provider"}
          onclick={openWorkspaceProvisioning}
        >+</button>
      </div>
      {#if environmentInfoOpen && selectedEnvironment}
        <button class="session-sidebar-instance-tooltip-dismiss" type="button" tabindex="-1" aria-label="Dismiss environment information backdrop" onclick={dismissEnvironmentInfo}></button>
        <section class="session-sidebar-instance-tooltip" aria-label={`Environment information for ${selectedEnvironment.environmentName}`}>
          <header>
            <span>
              <small>Environment · {selectedEnvironment.kind}</small>
              <strong>{selectedEnvironment.environmentName}</strong>
            </span>
            <span class="session-sidebar-environment-tooltip-actions">
              <span class={`session-sidebar-instance-status status-${workspaceStatus(selectedEnvironment)}`}>{statusLabel(selectedEnvironment.status)}</span>
              <button type="button" class="session-sidebar-environment-tooltip-close" aria-label="Close environment information" onclick={dismissEnvironmentInfo}>×</button>
            </span>
          </header>
          <dl>
            {#each selectedEnvironmentInfo as row (row.label)}
              <div>
                <dt>{row.label}</dt>
                <dd title={row.raw}>{row.value}</dd>
              </div>
            {/each}
          </dl>
        </section>
      {/if}
    </div>
  {:else if hubMode}
    <button type="button" class="session-sidebar-environment-empty-create" onclick={openWorkspaceProvisioning}>+ Connect cloud provider</button>
  {/if}
  <div class="session-sidebar-list">
    {#if hubMode && availableWorkspacesLoaded && !environmentOptions.length}
      <div class="r-empty">(no available environments)</div>
    {:else if searching}
      {#if $sessionPicker.searchStatus}<div class="session-sidebar-status">{$sessionPicker.searchStatus}</div>{/if}
      {#if hubMode}
        {#each visibleSearchEnvironments as environment (environment.environmentId)}
          <section class="session-sidebar-environment-view">
            {#each environment.workspaces as workspace (workspace.workspaceId)}
              <section
                class="session-sidebar-workspace-container"
                class:current-workspace={isCurrentWorkspace(environment, workspace)}
              >
                {@render WorkspaceHeading(workspace)}
                {@render SearchGroups(workspace.groups)}
              </section>
            {/each}
          </section>
        {/each}
      {:else}
        {@render SearchGroups($sessionPicker.searchResults)}
      {/if}
    {:else if hubMode && visibleSessionEnvironments.length}
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
    {:else if !hubMode && sessionGroups.length}
      {#each spokeRecentGroups as group (`recent:${group.cwd}`)}
        {@render CwdCategory({ group })}
      {/each}
      {#if spokeArchivedGroups.length}
        <details class="session-sidebar-archive">
          <summary class="session-archive-divider" title="Manually archived or head older than 2 days">
            <span>Archived</span>
            <small>{spokeArchivedCount} session{spokeArchivedCount === 1 ? "" : "s"}</small>
          </summary>
          <div class="session-sidebar-archive-groups">
            {#each spokeArchivedGroups as group (`archived:${group.cwd}`)}
              {@render CwdCategory({ group, archived: true })}
            {/each}
          </div>
        </details>
      {/if}
    {:else}
      <div class="r-empty">(no active sessions)</div>
    {/if}
  </div>
</aside>
