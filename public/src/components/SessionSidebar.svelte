<script>
  import { onDestroy, onMount } from "svelte";
  import SearchHitSnippet from "./SearchHitSnippet.svelte";
  import { appSession } from "../stores/appSession.js";
  import { sessionPicker, updateSessionPicker } from "../stores/sessionPicker.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { runnerSessionIdentity, sessionIdentity } from "../lib/sessionIdentity.js";
  import { formatRelativeTime } from "../lib/relativeTime.js";
  import { abbreviateHomePath } from "../lib/pathDisplay.js";
  import { incrementalCollectionPage, nextCollectionPageCount } from "../lib/incrementalCollection.js";
  import { createAsyncRequestGuard } from "../lib/asyncRequestGuard.js";
  import { effectiveWorkspaceStatus, isHubRuntime, setActiveWorkspace } from "../runtime/workspaceScope.js";
  import { getWorkspaceService } from "../runtime/workspaceServiceContext.js";
  import { openModal } from "../stores/modal.js";
  import { workspaceChanges } from "../stores/workspaces.js";
  import { cloudBrowser } from "../features/cloud/cloudBrowser.js";
  import { groupSessionCwdsByHierarchy, groupSessionSearchByHierarchy, groupSessionsByCwd, partitionSessionGroupsByArchive, prepareSessionEntryFamilies } from "../features/sessions/sessionPickerViewModel.js";
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
  const workspaceService = getWorkspaceService();
  const runtimeConfig = globalThis.__OYSTER_RUNTIME_CONFIG__ ?? {};
  const hubMode = isHubRuntime(runtimeConfig);
  const hierarchyDefaults = {
    environmentId: runtimeConfig.environment?.id || "local",
    environmentName: runtimeConfig.environment?.name || "Environment",
    workspaceId: runtimeConfig.workspace?.id || "local",
    workspaceName: runtimeConfig.workspace?.name || "Workspace",
  };
  const SEARCH_QUERY_MIN_LENGTH = 3;
  const SEARCH_DEBOUNCE_MS = 250;
  const ENVIRONMENT_REFRESH_MS = 5_000;
  const CLOCK_REFRESH_MS = 60_000;
  const SESSION_PAGE_SIZE = 40;
  const SEARCH_GROUP_PAGE_SIZE = 20;
  const SEARCH_HIT_PAGE_SIZE = 10;
  const LOOP_COMPLETION_STATUSES = new Set(["succeeded", "failed"]);
  const MANAGED_WORKSPACE_TYPES = new Set(["cloud", "llmbox"]);
  const KNOWN_WORKSPACE_STATUSES = new Set([
    "online", "provisioning", "provisioned", "awaiting_agent", "initializing", "resuming",
    "paused", "pausing", "destroying", "offline", "failed",
  ]);
  const STATUS_LABELS = {
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
  };

  let requestedEnvironmentId = $state(null);

  const switchRunner = (id) => {
    const runner = $appSession.runners.find((candidate) => candidate.id === id);
    if (hubMode) {
      if (runner?.environmentId) requestedEnvironmentId = runner.environmentId;
      setActiveWorkspace(runner?.workspaceId);
    }
    return uiActions.invoke(SESSION_SWITCH_RUNNER_ACTION, id);
  };
  const openSavedSession = (session) => {
    if (hubMode) {
      if (session?.environmentId) requestedEnvironmentId = session.environmentId;
      setActiveWorkspace(session?.workspaceId);
    }
    return uiActions.invoke(SESSION_PICKER_CHOOSE_ACTION, sessionIdentity(session));
  };
  const refreshSessions = () => uiActions.invoke(SESSION_SIDEBAR_REFRESH_ACTION);
  const createSessionInCwd = (cwd) => uiActions.invoke(SESSION_SIDEBAR_CREATE_IN_CWD_ACTION, cwd);
  const createSessionInGroup = (group) => {
    if (hubMode) {
      if (group.environmentId) requestedEnvironmentId = group.environmentId;
      setActiveWorkspace(group.workspaceId);
    }
    return createSessionInCwd(group.cwd);
  };
  const createSessionInFolder = (workspace = null) => uiActions.invoke(SESSION_SIDEBAR_CREATE_IN_FOLDER_ACTION, workspace);
  const openSearchHit = (group, hit) => {
    if (hubMode) {
      requestedEnvironmentId = hit.environmentId || group.first?.environmentId || selectedEnvironmentId;
      setActiveWorkspace(hit.workspaceId || group.first?.workspaceId);
    }
    return uiActions.invoke(SESSION_PICKER_OPEN_SEARCH_HIT_ACTION, group.sessionKey, hit);
  };
  const stopSession = (runner) => uiActions.invoke(SESSION_PICKER_STOP_ACTION, savedSession(runner) ?? runner);
  const archiveSession = (session) => uiActions.invoke(SESSION_PICKER_ARCHIVE_ACTION, session);
  const deleteSession = (runner) => uiActions.invoke(SESSION_PICKER_DELETE_ACTION, savedSession(runner) ?? runner);

  let searchTimer = null;
  function runSearch() {
    clearTimeout(searchTimer);
    searchTimer = null;
    if ($sessionPicker.query.trim().length < SEARCH_QUERY_MIN_LENGTH) return;
    uiActions.invoke(SESSION_PICKER_SET_SCOPE_ACTION, "all");
    uiActions.invoke(SESSION_PICKER_SEARCH_ACTION);
  }
  function updateQuery(value) {
    const query = String(value ?? "");
    const queryIsLongEnough = query.trim().length >= SEARCH_QUERY_MIN_LENGTH;
    updateSessionPicker({
      query,
      ...(!queryIsLongEnough ? { searchStatus: "", searchResults: [], searching: false } : {}),
    });
    clearTimeout(searchTimer);
    searchTimer = null;
    if (!queryIsLongEnough) return;
    searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
  }

  let availableEnvironments = $state([]);
  let availableWorkspaces = $state([]);
  let availableWorkspacesLoaded = $state(!hubMode);
  const catalogRequests = createAsyncRequestGuard();
  let environmentInfoOpen = $state(false);
  let environmentInfoEnvironmentId = $state(null);
  async function refreshEnvironmentCatalog(preferredId = null) {
    if (!hubMode) return;
    const request = catalogRequests.begin();
    try {
      const [environments, workspaces] = await Promise.all([
        workspaceService.listEnvironments(),
        workspaceService.listWorkspaces(),
      ]);
      if (!request.isCurrent()) return;
      availableEnvironments = environments;
      availableWorkspaces = workspaces;
      availableWorkspacesLoaded = true;
      if (preferredId) requestedEnvironmentId = preferredId;
    } catch {
      if (!request.isCurrent()) return;
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
    requestedEnvironmentId = event.currentTarget.value;
    closeEnvironmentInfo();
  }
  function toggleEnvironmentInfo() {
    if (!selectedEnvironment) return;
    if (environmentInfoVisible) closeEnvironmentInfo();
    else {
      environmentInfoEnvironmentId = selectedEnvironment.environmentId;
      environmentInfoOpen = true;
    }
  }
  function handleEnvironmentInfoKeydown(event) {
    if (event.key === "Escape") closeEnvironmentInfo();
  }
  let workspaceActions = $state(new Set());
  function managedWorkspace(workspace) {
    return MANAGED_WORKSPACE_TYPES.has(workspace.provider?.type);
  }
  async function manageWorkspace(workspace, action) {
    if (!workspace?.workspaceId || workspaceActions.has(workspace.workspaceId)) return;
    const verb = action === "destroy" ? "Destroy" : action === "resume" ? "Resume" : "Pause";
    const llmbox = workspace.provider?.type === "llmbox";
    const warning = action === "destroy"
      ? `Destroy “${workspace.workspaceName}” permanently?\n\nThe ${llmbox ? "llmbox VM" : "provider VM"} and its disk, sessions, and stored model credentials will be deleted. This cannot be undone.`
      : action === "pause"
        ? `Pause “${workspace.workspaceName}”?\n\nActive sessions will disconnect. The VM disk is retained${llmbox ? "." : "; storage charges continue, and DigitalOcean may continue charging for the reserved Droplet."}`
        : `Resume “${workspace.workspaceName}”?`;
    if (!confirm(warning)) return;
    workspaceActions = new Set([...workspaceActions, workspace.workspaceId]);
    try {
      await workspaceService.manageWorkspace(workspace.workspaceId, action);
      if (action === "destroy" && currentRunner?.workspaceId === workspace.workspaceId) {
        const replacement = availableWorkspaces.find((candidate) => (
          candidate.id !== workspace.workspaceId
          && candidate.environmentId === selectedEnvironmentId
          && effectiveWorkspaceStatus(candidate) === "online"
        ));
        if (replacement) setActiveWorkspace(replacement.id);
      }
      await refreshEnvironmentCatalog();
      if (!destroyed) refreshSessions();
    } catch (cause) {
      if (!destroyed) alert(`${verb} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      if (!destroyed) {
        const next = new Set(workspaceActions);
        next.delete(workspace.workspaceId);
        workspaceActions = next;
      }
    }
  }
  let destroyed = false;
  let environmentRefreshTimer = null;
  let clockTimer = null;
  let unsubscribeWorkspaceChanges = null;
  let unsubscribeRunnerChanges = null;
  let unsubscribeResume = null;
  let clock = $state(Date.now());
  let workspaceRevision = 0;
  let runnerSignature = "";
  let runnerSignatureInitialized = false;

  onMount(() => {
    refreshEnvironmentCatalog();
    environmentRefreshTimer = setInterval(refreshEnvironmentCatalog, ENVIRONMENT_REFRESH_MS);
    clockTimer = setInterval(() => { clock = Date.now(); }, CLOCK_REFRESH_MS);
    unsubscribeWorkspaceChanges = workspaceChanges.subscribe((change) => {
      if (change.revision <= workspaceRevision) return;
      workspaceRevision = change.revision;
      refreshEnvironmentCatalog(change.workspace?.environmentId);
    });
    unsubscribeRunnerChanges = appSession.subscribe(({ runners }) => refreshForRunnerChanges(runners));
    unsubscribeResume = cloudBrowser.onResume(() => {
      if (destroyed || cloudBrowser.hidden()) return;
      refreshEnvironmentCatalog();
      refreshSessions();
    });
    if (hubMode && cloudBrowser.hasConnectionReturn()) openWorkspaceProvisioning();
  });

  onDestroy(() => {
    destroyed = true;
    catalogRequests.invalidate();
    clearTimeout(searchTimer);
    clearInterval(environmentRefreshTimer);
    clearInterval(clockTimer);
    unsubscribeWorkspaceChanges?.();
    unsubscribeRunnerChanges?.();
    unsubscribeResume?.();
  });

  const searching = $derived($sessionPicker.query.trim().length >= SEARCH_QUERY_MIN_LENGTH);
  const searchEnvironments = $derived(hubMode ? groupSessionSearchByHierarchy($sessionPicker.searchResults, hierarchyDefaults) : []);
  const sidebarRunners = $derived($appSession.runners.filter((runner) => runner.sessionId));
  const currentRunner = $derived($appSession.runners.find((runner) => runner.id === $appSession.currentRunner));
  const currentCwd = $derived(currentRunner?.dir ?? null);
  const sessionGroups = $derived(partitionSessionGroupsByArchive(
    groupSessionsByCwd($sessionPicker.allSessions, sidebarRunners),
  ).map((group) => ({ ...group, families: prepareSessionEntryFamilies(group.entries) })));
  const spokeRecentGroups = $derived(hubMode ? [] : sessionGroups.filter((group) => !group.archived));
  const spokeArchivedGroups = $derived(hubMode ? [] : sessionGroups.filter((group) => group.archived));
  const spokeArchivedCount = $derived(spokeArchivedGroups.reduce((count, group) => count + group.entries.length, 0));
  const sessionEnvironments = $derived(hubMode ? groupSessionCwdsByHierarchy(sessionGroups, hierarchyDefaults) : []);
  const discoveredEnvironmentOptions = $derived(environmentOptionsFromCatalog(availableEnvironments));
  const environmentOptions = $derived(!hubMode
    ? []
    : availableWorkspacesLoaded
      ? discoveredEnvironmentOptions
      : mergeEnvironmentOptions(sessionEnvironments, searchEnvironments));
  const selectedEnvironmentId = $derived(
    environmentOptions.some((environment) => environment.environmentId === requestedEnvironmentId)
      ? requestedEnvironmentId
      : preferredEnvironmentId(environmentOptions),
  );
  const selectedEnvironment = $derived(environmentOptions.find((environment) => environment.environmentId === selectedEnvironmentId) ?? null);
  const environmentInfoVisible = $derived(Boolean(
    environmentInfoOpen
    && selectedEnvironment
    && selectedEnvironment.environmentId === environmentInfoEnvironmentId,
  ));
  const selectedEnvironmentInfo = $derived(selectedEnvironment ? environmentInfo(selectedEnvironment) : []);
  const availableWorkspaceIds = $derived(hubMode && availableWorkspacesLoaded
    ? new Set(availableWorkspaces
      .filter((workspace) => workspace.environmentId === selectedEnvironmentId)
      .map((workspace) => workspace.id))
    : null);
  const visibleSessionEnvironments = $derived(availableWorkspaceIds
    ? availableEnvironmentView(sessionEnvironments, selectedEnvironmentId, availableWorkspaces)
    : filterEnvironmentWorkspaces(sessionEnvironments, selectedEnvironmentId, null));
  const visibleSearchEnvironments = $derived(searchEnvironmentView(searchEnvironments, availableWorkspaces));

  let cwdExpansionChoices = $state(new Map());
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
        ...(existing?.workspaces?.find((candidate) => candidate.workspaceId === workspace.id) ?? {
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
  function searchEnvironmentView(environments, workspaces) {
    return environments.map((environment) => ({
      ...environment,
      workspaces: environment.workspaces.map((workspace) => {
        const discovered = workspaces.find((candidate) => candidate.id === workspace.workspaceId);
        return discovered ? {
          ...workspace,
          status: effectiveWorkspaceStatus(discovered),
          provider: discovered.provider,
        } : workspace;
      }),
    }));
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
    return KNOWN_WORKSPACE_STATUSES.has(status) ? status : "unknown";
  }
  function statusLabel(status) {
    return STATUS_LABELS[status] ?? STATUS_LABELS.unknown;
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
  function cwdIsExpanded(group) {
    const key = cwdExpansionKey(group);
    return cwdExpansionChoices.has(key) ? cwdExpansionChoices.get(key) : isCurrentCwd(group);
  }
  function setCwdExpanded(key, open) {
    cwdExpansionChoices = new Map(cwdExpansionChoices).set(key, open);
  }
  let expandedSessionFamilies = $state(new Set());
  let collectionLimits = $state(new Map());
  function collectionPage(items, limits, key, pageSize = SESSION_PAGE_SIZE) {
    return incrementalCollectionPage(items, limits.get(key), pageSize);
  }
  function revealCollectionPage(key, page) {
    const next = new Map(collectionLimits);
    next.set(key, nextCollectionPageCount(page.visibleCount, page.visibleCount + page.remainingCount, page.pageSize));
    collectionLimits = next;
  }
  function entryIdentity(entry) {
    return entry.session ? sessionIdentity(entry.session) : runnerSessionIdentity(entry.runner);
  }
  function toggleSessionFamily(familyKey) {
    if (!familyKey) return;
    const next = new Set(expandedSessionFamilies);
    if (next.has(familyKey)) next.delete(familyKey); else next.add(familyKey);
    expandedSessionFamilies = next;
  }
  function selectSessionEntry(session, runner, familyKey = null) {
    if (familyKey) {
      toggleSessionFamily(familyKey);
      return;
    }
    return runner ? switchRunner(runner.id) : openSavedSession(session);
  }
  function loopEntryStatus(entry) {
    if (entry.runner?.alive) return "running";
    if (LOOP_COMPLETION_STATUSES.has(entry.runner?.subagentStatus)) return entry.runner.subagentStatus;
    return "succeeded";
  }
  function loopStatusLabel(status) {
    return status === "running" ? "Running" : status === "failed" ? "Failed" : "Succeeded";
  }
  function loopFamilySummary(family) {
    let running = 0;
    let failed = 0;
    for (const entry of family.children) {
      const status = loopEntryStatus(entry);
      if (status === "running") running += 1;
      else if (status === "failed") failed += 1;
    }
    const total = family.children.length;
    const complete = total - running;
    if (running || family.entry.runner?.busy) return { status: "running", label: `${complete}/${total}` };
    if (failed) return { status: "failed", label: `${failed} failed` };
    return { status: "succeeded", label: `${complete}/${total}` };
  }
  function familyIsCurrent(family) {
    return family.children.some((entry) => entry.runner?.id === $appSession.currentRunner || (!entry.runner && entry.session?.id === $sessionPicker.currentId));
  }

  function refreshForRunnerChanges(runners) {
    const nextSignature = runners.filter((runner) => runner.sessionId).map((runner) => [
      runner.id,
      runner.sessionKey ?? runner.sessionId,
      runner.sessionName ?? "",
      runner.alive ? (runner.busy ? "busy" : "idle") : "stopped",
    ].join(":")).join("|");
    const shouldRefresh = nextSignature !== runnerSignature && (runnerSignatureInitialized || Boolean(nextSignature));
    runnerSignature = nextSignature;
    runnerSignatureInitialized = true;
    if (shouldRefresh) queueMicrotask(() => {
      if (!destroyed) refreshSessions();
    });
  }

  const savedSessionsByIdentity = $derived.by(() => {
    const sessions = [
      ...$sessionPicker.allSessions,
      ...$sessionPicker.sessions,
      ...Object.values($sessionPicker.otherFolderSessions).flat(),
    ];
    const byIdentity = new Map();
    for (const session of sessions) {
      const identity = sessionIdentity(session);
      if (identity && !byIdentity.has(identity)) byIdentity.set(identity, session);
    }
    return byIdentity;
  });

  function savedSession(runner) {
    return savedSessionsByIdentity.get(runnerSessionIdentity(runner));
  }

  function label(session, runner) {
    return runner?.sessionName || session?.name || session?.preview || "Empty session";
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

{#snippet SessionEntry({ entry, archived = false, cwd = "", familyKey = null, timelineStatus = null })}
  {@const session = entry.session}
  {@const runner = entry.runner}
  {@const meta = sessionMeta(session, runner)}
  {@const current = runner?.id === $appSession.currentRunner || (!runner && session?.id === $sessionPicker.currentId)}
  <div class="session-sidebar-entry" class:current class:session-family-parent={Boolean(familyKey)} class:session-timeline-entry={Boolean(timelineStatus)} class:status-running={timelineStatus === "running"} class:status-succeeded={timelineStatus === "succeeded"} class:status-failed={timelineStatus === "failed"}>
    <button
      type="button"
      class:busy={runner?.busy}
      class="session-sidebar-row"
      title={`${label(session, runner)}\n${timelineStatus ? `${loopStatusLabel(timelineStatus)}\n` : ""}${abbreviateHomePath(cwd)}`}
      onclick={() => selectSessionEntry(session, runner, familyKey)}
    >
      {#if timelineStatus}
        <span class="session-timeline-marker" role="img" aria-label={loopStatusLabel(timelineStatus)}></span>
      {:else}
        <span class="s-dot" class:on={runner?.alive && !runner?.busy} class:busy={runner?.alive && runner?.busy} aria-hidden="true"></span>
      {/if}
      <span class="session-sidebar-copy">
        <span class="session-sidebar-name">{label(session, runner)}</span>
        {#if meta}
          <span class="session-sidebar-meta">{meta}</span>
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
{/snippet}

{#snippet LoopFamilyHeader({ family, familyKey, archived = false })}
  {@const session = family.entry.session}
  {@const runner = family.entry.runner}
  {@const summary = loopFamilySummary(family)}
  {@const expanded = expandedSessionFamilies.has(familyKey) || familyIsCurrent(family)}
  <div class={`session-loop-card status-${summary.status}`}>
    <button
      type="button"
      class="session-loop-header"
      aria-expanded={expanded}
      title={`${label(session, runner)}\n${family.children.length} loop iterations`}
      onclick={() => toggleSessionFamily(familyKey)}
    >
      <span class="session-loop-icon" aria-hidden="true">↻</span>
      <span class="session-loop-copy">
        <span class="session-loop-kicker">Loop · {family.children.length} iteration{family.children.length === 1 ? "" : "s"}</span>
        <span class="session-sidebar-name">{label(session, runner)}</span>
      </span>
      <span class={`session-loop-progress status-${summary.status}`}>{summary.label}</span>
      <span class="session-loop-chevron" aria-hidden="true"></span>
    </button>
    {#if runner?.alive}
      <button type="button" class="session-sidebar-action stop" title="Stop this loop" aria-label="Stop this loop" onclick={() => stopSession(runner)}></button>
    {:else if archived && session}
      <button type="button" class="session-sidebar-action delete" title="Delete archived loop" aria-label="Delete archived loop" onclick={() => deleteSession(session)}>✕</button>
    {:else if session}
      <button type="button" class="session-sidebar-lifecycle archive" title="Archive loop" aria-label="Archive loop" onclick={() => archiveSession(session)}></button>
    {/if}
  </div>
{/snippet}

{#snippet SessionRows({ families, group, archived = false, cwd = "", listKey = cwd })}
  {@const familyPage = collectionPage(families, collectionLimits, `families:${listKey}`)}
  <div class="session-sidebar-workspace-sessions">
    {#if !archived}
      <button
        type="button"
        class="session-sidebar-placeholder"
        title={`Add session in ${group.cwd}`}
        aria-label={`Add session in ${group.cwd}`}
        onclick={() => createSessionInGroup(group)}
      >
        <span class="session-sidebar-placeholder-icon" aria-hidden="true">+</span>
        <span class="session-sidebar-copy">
          <span class="session-sidebar-name">Add session</span>
          <span class="session-sidebar-meta">Start a new session in this directory</span>
        </span>
      </button>
    {/if}
    {#each familyPage.items as family (entryIdentity(family.entry))}
      {@const familyKey = entryIdentity(family.entry)}
      {@const loopFamily = family.loop}
      {#if loopFamily}
        {@render LoopFamilyHeader({ family, familyKey, archived })}
      {:else}
        {@render SessionEntry({ entry: family.entry, archived, cwd })}
      {/if}
      {@const childPage = collectionPage(family.children, collectionLimits, `children:${familyKey}`)}
      {#if loopFamily && (expandedSessionFamilies.has(familyKey) || familyIsCurrent(family))}
        <div class="session-sidebar-loop-timeline" aria-label={`${family.children.length} loop iteration${family.children.length === 1 ? "" : "s"}`}>
          {#each childPage.items as entry (entryIdentity(entry))}
            {@render SessionEntry({ entry, archived, cwd, timelineStatus: loopEntryStatus(entry) })}
          {/each}
          {#if childPage.remainingCount}
            <button type="button" class="session-sidebar-load-more" onclick={() => revealCollectionPage(`children:${familyKey}`, childPage)}>Show {Math.min(SESSION_PAGE_SIZE, childPage.remainingCount)} more iterations</button>
          {/if}
        </div>
      {:else if family.children.length && !loopFamily}
        <details class="session-sidebar-child-sessions" open={familyIsCurrent(family)}>
          <summary>{family.children.length} child session{family.children.length === 1 ? "" : "s"}</summary>
          <div class="session-sidebar-child-list">
            {#each childPage.items as entry (entryIdentity(entry))}
              {@render SessionEntry({ entry, archived, cwd })}
            {/each}
            {#if childPage.remainingCount}
              <button type="button" class="session-sidebar-load-more" onclick={() => revealCollectionPage(`children:${familyKey}`, childPage)}>Show {Math.min(SESSION_PAGE_SIZE, childPage.remainingCount)} more child sessions</button>
            {/if}
          </div>
        </details>
      {/if}
    {/each}
    {#if familyPage.remainingCount}
      <button type="button" class="session-sidebar-load-more" onclick={() => revealCollectionPage(`families:${listKey}`, familyPage)}>Show {Math.min(SESSION_PAGE_SIZE, familyPage.remainingCount)} more sessions</button>
    {/if}
  </div>
{/snippet}

{#snippet CwdCategory({ group, archived = false })}
  <details
    class="session-sidebar-cwd"
    class:current-cwd={isCurrentCwd(group)}
    open={cwdIsExpanded(group)}
    ontoggle={(event) => setCwdExpanded(cwdExpansionKey(group), event.currentTarget.open)}
  >
    <summary title={group.cwd}>
      <span class="session-sidebar-cwd-icon" aria-hidden="true"></span>
      <span class="session-sidebar-cwd-label">{abbreviateHomePath(group.cwd)}</span>
      <span class="session-sidebar-count">{group.entries.length}</span>
    </summary>
    {@render SessionRows({ families: group.families, group, archived, cwd: group.cwd, listKey: cwdExpansionKey(group) })}
  </details>
{/snippet}

{#snippet SearchGroups({ groups, listKey })}
  {@const groupPage = collectionPage(groups, collectionLimits, `search:${listKey}`, SEARCH_GROUP_PAGE_SIZE)}
  {#each groupPage.items as group (group.sessionKey)}
    {@const hitPage = collectionPage(group.hits, collectionLimits, `search-hits:${group.sessionKey}`, SEARCH_HIT_PAGE_SIZE)}
    <section class="session-sidebar-hit-group" title={group.sessionKey}>
      <div class="session-sidebar-hit-heading">
        <span class="session-sidebar-name">{group.first.sessionName || group.first.sessionPreview || "Empty session"}</span>
        <span class="session-sidebar-hit-count">{group.hits.length}</span>
      </div>
      <span
        class="session-sidebar-folder"
        title={group.first.sessionCwd || group.first.folderLabel || ""}
      >{abbreviateHomePath(group.first.sessionCwd || group.first.folderLabel) || "Unknown working directory"}</span>
      <div class="session-sidebar-hit-list">
        {#each hitPage.items as hit (hit.entryId ?? `${hit.role}:${hit.timestamp}:${hit.snippet.match}`)}
          <button
            type="button"
            class="session-sidebar-hit"
            onclick={() => openSearchHit(group, hit)}
          >
            <span class="session-sidebar-snippet">
              <SearchHitSnippet
                role={hit.role}
                kind={hit.kind}
                snippet={{ before: snippetBefore(hit.snippet.before), match: hit.snippet.match, after: snippetAfter(hit.snippet.after) }}
                query={$sessionPicker.query}
                copyClass="session-sidebar-snippet-copy"
              />
            </span>
          </button>
        {/each}
        {#if hitPage.remainingCount}
          <button type="button" class="session-sidebar-load-more" onclick={() => revealCollectionPage(`search-hits:${group.sessionKey}`, hitPage)}>Show {Math.min(SEARCH_HIT_PAGE_SIZE, hitPage.remainingCount)} more matches</button>
        {/if}
      </div>
    </section>
  {/each}
  {#if groupPage.remainingCount}
    <button type="button" class="session-sidebar-load-more" onclick={() => revealCollectionPage(`search:${listKey}`, groupPage)}>Show {Math.min(SEARCH_GROUP_PAGE_SIZE, groupPage.remainingCount)} more matching sessions</button>
  {/if}
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
    {#if managedWorkspace(workspace)}
      <span class="session-sidebar-workspace-cloud-actions">
        <button
          type="button"
          class="session-sidebar-workspace-power"
          class:resume={status === "paused"}
          title={status === "paused" ? `Resume ${workspace.workspaceName}` : `Pause ${workspace.workspaceName}`}
          aria-label={status === "paused" ? `Resume ${workspace.workspaceName}` : `Pause ${workspace.workspaceName}`}
          disabled={managing || !["online", "paused"].includes(status)}
          onclick={() => manageWorkspace(workspace, status === "paused" ? "resume" : "pause")}
        >{status === "paused" ? "▶" : "Ⅱ"}</button>
        <button
          type="button"
          class="session-sidebar-workspace-destroy"
          title={`Destroy ${workspace.workspaceName}`}
          aria-label={`Destroy ${workspace.workspaceName}`}
          disabled={managing || status === "destroying"}
          onclick={() => manageWorkspace(workspace, "destroy")}
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
  <form role="search" onsubmit={(event) => {
    event.preventDefault();
    runSearch();
  }}>
    <input
      class="session-sidebar-search"
      type="search"
      aria-label="Search sessions"
      placeholder="search sessions…"
      value={$sessionPicker.query}
      aria-busy={$sessionPicker.searching}
      oninput={(event) => updateQuery(event.currentTarget.value)}
    />
  </form>
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
  {#if hubMode && environmentOptions.length && selectedEnvironment}
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
          class:active={environmentInfoVisible}
          title={`Environment information for ${selectedEnvironment.environmentName}`}
          aria-label={`${environmentInfoVisible ? "Hide" : "Show"} environment information for ${selectedEnvironment.environmentName}`}
          aria-expanded={environmentInfoVisible}
          aria-controls="sessionSidebarEnvironmentInfo"
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
      {#if environmentInfoVisible && selectedEnvironment}
        <button class="session-sidebar-instance-tooltip-dismiss" type="button" tabindex="-1" aria-label="Dismiss environment information backdrop" onclick={dismissEnvironmentInfo}></button>
        <section id="sessionSidebarEnvironmentInfo" class="session-sidebar-instance-tooltip" aria-label={`Environment information for ${selectedEnvironment.environmentName}`}>
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
      {#if $sessionPicker.searchStatus}<div class="session-sidebar-status" role="status" aria-atomic="true">{$sessionPicker.searchStatus}</div>{/if}
      {#if hubMode}
        {#each visibleSearchEnvironments as environment (environment.environmentId)}
          <section class="session-sidebar-environment-view">
            <div class="session-sidebar-search-environment-heading">
              <small>Environment</small>
              <strong>{environment.environmentName}</strong>
            </div>
            {#each environment.workspaces as workspace (workspace.workspaceId)}
              <section
                class="session-sidebar-workspace-container"
                class:current-workspace={isCurrentWorkspace(environment, workspace)}
              >
                {@render WorkspaceHeading(workspace)}
                {@render SearchGroups({ groups: workspace.groups, listKey: `${environment.environmentId}:${workspace.workspaceId}` })}
              </section>
            {/each}
          </section>
        {/each}
      {:else}
        {@render SearchGroups({ groups: $sessionPicker.searchResults, listKey: "local" })}
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

<style>
  #sessions {
    width: var(--sidebar-width);
    flex-shrink: 0;
    flex-direction: column;
    gap: 12px;
    padding: 18px 12px 14px;
    overflow-y: auto;
  }

  form { flex: none; }

  .session-sidebar-search {
    width: 100%;
    height: 36px;
    padding: 8px 11px 8px 33px;
    border: 1px solid transparent;
    border-radius: 10px;
    outline: 0;
    background-color: color-mix(in srgb, var(--text) 4.5%, transparent);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='none' stroke='%237d8599' stroke-width='1.6'%3E%3Ccircle cx='6' cy='6' r='4.2'/%3E%3Cpath d='m9.2 9.2 3.2 3.2'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: 11px center;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    transition: border-color .15s, background-color .15s, box-shadow .15s;
  }

  .session-sidebar-search:hover { background-color: color-mix(in srgb, var(--text) 6%, transparent); }
  .session-sidebar-search:focus-visible {
    border-color: color-mix(in srgb, var(--accent) 52%, var(--border));
    background-color: color-mix(in srgb, var(--text) 6.5%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 9%, transparent);
  }
  .session-sidebar-search[aria-busy="true"] { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }

  .session-sidebar-new { display: flex; width: 100%; filter: drop-shadow(0 7px 18px color-mix(in srgb, var(--bg) 35%, transparent)); }
  .session-sidebar-create,
  .session-sidebar-create-folder {
    border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
    background: color-mix(in srgb, var(--accent) 9%, var(--panel-2));
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition: border-color .15s, background-color .15s, color .15s;
  }
  .session-sidebar-create {
    display: flex;
    min-width: 0;
    min-height: 42px;
    flex: 1;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-right: 0;
    border-radius: 10px 0 0 10px;
    text-align: left;
  }
  .session-sidebar-create-folder {
    display: grid;
    width: 36px;
    flex: none;
    place-items: center;
    padding: 0;
    border-radius: 0 10px 10px 0;
    color: var(--muted);
  }
  .session-sidebar-create:hover:not(:disabled),
  .session-sidebar-create-folder:hover { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); background: color-mix(in srgb, var(--accent) 16%, var(--panel-2)); }
  .session-sidebar-create:disabled { cursor: not-allowed; opacity: .45; }
  .session-sidebar-create-icon { flex: none; color: var(--accent); font-size: 18px; line-height: 1; }
  .session-sidebar-create-copy { display: grid; min-width: 0; line-height: 1.2; }
  .session-sidebar-create-copy strong { color: color-mix(in srgb, var(--accent) 38%, var(--text)); font-size: 12px; font-weight: 650; }
  .session-sidebar-create-copy small { overflow: hidden; color: var(--muted); font-size: 9.5px; text-overflow: ellipsis; white-space: nowrap; }
  .session-sidebar-create-chevron { width: 7px; height: 7px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translateY(-2px) rotate(45deg); }

  .session-sidebar-list { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 8px; overflow-y: auto; overscroll-behavior: contain; }

  .session-sidebar-environment-picker { position: relative; width: 100%; min-width: 0; flex: none; }
  .session-sidebar-environment-selector {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: stretch;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 5%, var(--panel-2));
    color: var(--muted);
  }
  .session-sidebar-environment-control { display: flex; min-width: 0; min-height: 38px; flex: 1; align-items: center; gap: 7px; padding: 6px 8px; }
  .session-sidebar-environment-label,
  .session-sidebar-hierarchy-copy small,
  .session-sidebar-search-environment-heading small { flex: none; color: var(--muted); font-size: 8px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  .session-sidebar-environment-selector select { min-width: 0; flex: 1; padding: 0 2px; border: 0; outline: 0; background: transparent; color: color-mix(in srgb, var(--accent) 35%, var(--text)); font: inherit; font-size: 10.5px; font-weight: 600; cursor: pointer; }
  .session-sidebar-environment-selector select option { background: var(--panel-2); color: var(--text); }
  .session-sidebar-environment-tab-icon { width: 9px; height: 7px; flex: none; border: 1px solid currentColor; border-radius: 2px; }
  .session-sidebar-environment-info,
  .session-sidebar-environment-create {
    width: 34px;
    flex: none;
    padding: 0;
    border: 0;
    border-left: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    transition: background-color .14s, color .14s;
  }
  .session-sidebar-environment-info { width: 30px; font: 700 10px/1 var(--mono); }
  .session-sidebar-environment-create { font: 17px/1 inherit; }
  .session-sidebar-environment-info:hover,
  .session-sidebar-environment-create:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--text); }
  .session-sidebar-environment-info.active { background: var(--selection-bg); color: var(--selection-text); box-shadow: inset 0 -1px 0 var(--selection-marker); }

  .session-sidebar-instance-tooltip-dismiss { position: fixed; inset: 0; z-index: 19; padding: 0; border: 0; background: transparent; cursor: default; }
  .session-sidebar-instance-tooltip {
    position: absolute;
    z-index: 20;
    top: calc(100% + 8px);
    left: 0;
    width: min(320px, calc(100vw - 24px));
    max-height: min(480px, calc(100vh - 150px));
    padding: 11px;
    overflow-y: auto;
    border: 1px solid color-mix(in srgb, var(--accent) 32%, var(--border));
    border-radius: 12px;
    background: var(--panel-2);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }
  .session-sidebar-instance-tooltip header { display: flex; align-items: start; justify-content: space-between; gap: 8px; margin-bottom: 9px; }
  .session-sidebar-instance-tooltip header > span:first-child { display: grid; min-width: 0; gap: 2px; }
  .session-sidebar-instance-tooltip header small { color: var(--muted); font-size: 8px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  .session-sidebar-instance-tooltip header strong { overflow-wrap: anywhere; font-size: 12px; }
  .session-sidebar-environment-tooltip-actions { display: flex; flex: none; align-items: center; gap: 7px; }
  .session-sidebar-environment-tooltip-close { display: grid; width: 28px; height: 28px; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--muted); font: 16px/1 inherit; cursor: pointer; }
  .session-sidebar-environment-tooltip-close:hover { border-color: var(--border); background: var(--surface-hover); color: var(--text); }
  .session-sidebar-instance-status { flex: none; font-size: 8px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
  .session-sidebar-instance-tooltip dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 8px; }
  .session-sidebar-instance-tooltip dl div { min-width: 0; padding: 6px 7px; border-top: 1px solid var(--border); border-right: 1px solid var(--border); }
  .session-sidebar-instance-tooltip dl div:nth-child(-n+2) { border-top: 0; }
  .session-sidebar-instance-tooltip dl div:nth-child(2n) { border-right: 0; }
  .session-sidebar-instance-tooltip dt { color: var(--muted); font-size: 8px; letter-spacing: .06em; text-transform: uppercase; }
  .session-sidebar-instance-tooltip dd { margin: 2px 0 0; overflow-wrap: anywhere; font: 9px/1.35 var(--mono); }

  .session-sidebar-instance-status.status-online,
  .session-sidebar-workspace-icon.status-online,
  .session-sidebar-workspace-status.status-online { color: var(--green); }
  .session-sidebar-instance-status:is(.status-provisioning, .status-provisioned, .status-awaiting_agent, .status-initializing, .status-resuming, .status-pausing),
  .session-sidebar-workspace-icon:is(.status-provisioning, .status-provisioned, .status-awaiting_agent, .status-initializing, .status-resuming, .status-pausing),
  .session-sidebar-workspace-status:is(.status-provisioning, .status-provisioned, .status-awaiting_agent, .status-initializing, .status-resuming, .status-pausing) { color: var(--yellow); }
  .session-sidebar-instance-status:is(.status-failed, .status-destroying),
  .session-sidebar-workspace-icon:is(.status-failed, .status-destroying),
  .session-sidebar-workspace-status:is(.status-failed, .status-destroying) { color: var(--red); }
  .session-sidebar-instance-status.status-paused,
  .session-sidebar-workspace-icon.status-paused,
  .session-sidebar-workspace-status.status-paused { color: var(--accent); }
  .session-sidebar-instance-status:is(.status-offline, .status-unknown),
  .session-sidebar-workspace-icon:is(.status-offline, .status-unknown),
  .session-sidebar-workspace-status:is(.status-offline, .status-unknown) { color: var(--muted); }
  .session-sidebar-workspace-icon:is(.status-provisioning, .status-awaiting_agent, .status-initializing, .status-resuming, .status-pausing) { animation: workspace-pulse 1.5s ease-in-out infinite; }

  .session-sidebar-environment-empty-create,
  .session-sidebar-load-more {
    width: 100%;
    min-height: 34px;
    padding: 6px 9px;
    border: 1px dashed color-mix(in srgb, var(--accent) 35%, var(--border));
    border-radius: 9px;
    background: color-mix(in srgb, var(--accent) 5%, transparent);
    color: var(--muted);
    font: 10.5px inherit;
    cursor: pointer;
  }
  .session-sidebar-environment-empty-create:hover,
  .session-sidebar-load-more:hover { border-style: solid; border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--text); }

  .session-sidebar-environment-view { display: flex; min-width: 0; flex-direction: column; gap: 8px; }
  .session-sidebar-search-environment-heading { display: flex; min-width: 0; align-items: baseline; gap: 7px; padding: 3px 5px 0; }
  .session-sidebar-search-environment-heading strong { overflow: hidden; color: var(--text); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
  .session-sidebar-workspace-container { display: flex; min-width: 0; flex: none; flex-direction: column; gap: 4px; padding: 5px; border: 1px solid color-mix(in srgb, var(--border) 82%, transparent); border-radius: 10px; }
  .session-sidebar-workspace-container.current-workspace { border-color: color-mix(in srgb, var(--accent) 14%, var(--border)); }
  .session-sidebar-workspace-heading { display: flex; min-width: 0; align-items: center; gap: 7px; padding: 4px 5px; border-radius: 7px; color: var(--text); }
  .workspace-unavailable { opacity: .76; }
  .session-sidebar-hierarchy-copy { display: grid; min-width: 0; flex: 1; gap: 1px; }
  .session-sidebar-workspace-kicker { display: flex; min-width: 0; align-items: center; gap: 5px; }
  .session-sidebar-hierarchy-copy strong { overflow: hidden; color: color-mix(in srgb, var(--accent) 30%, var(--text)); font-size: 11.5px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .session-sidebar-workspace-status { overflow: hidden; font-size: 8px; font-weight: 700; letter-spacing: .04em; line-height: 1; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
  .session-sidebar-workspace-heading code { max-width: 58px; overflow: hidden; color: var(--muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
  .session-sidebar-workspace-empty { padding: 8px 7px; color: var(--muted); font-size: 10px; text-align: center; }
  .session-sidebar-workspace-icon { width: 13px; height: 13px; flex: none; border: 1.5px solid currentColor; border-radius: 3px; background: color-mix(in srgb, currentColor 14%, transparent); color: var(--muted); transform: rotate(45deg) scale(.78); }
  .session-sidebar-workspace-cloud-actions { display: flex; flex: none; gap: 3px; }
  .session-sidebar-workspace-power,
  .session-sidebar-workspace-destroy,
  .session-sidebar-workspace-create { display: grid; flex: none; place-items: center; padding: 0; border: 1px solid var(--border); border-radius: 7px; background: transparent; color: var(--muted); font: 10px/1 inherit; cursor: pointer; }
  .session-sidebar-workspace-power,
  .session-sidebar-workspace-destroy { width: 24px; height: 24px; }
  .session-sidebar-workspace-create { width: 28px; height: 28px; border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); font-size: 16px; }
  .session-sidebar-workspace-power:hover:not(:disabled) { border-color: var(--yellow); color: var(--yellow); }
  .session-sidebar-workspace-power.resume:hover:not(:disabled) { border-color: var(--green); color: var(--green); }
  .session-sidebar-workspace-destroy:hover:not(:disabled) { border-color: var(--red); background: color-mix(in srgb, var(--red) 8%, transparent); color: var(--red); }
  .session-sidebar-workspace-create:hover:not(:disabled) { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--text); }
  .session-sidebar-workspace-power:disabled,
  .session-sidebar-workspace-destroy:disabled,
  .session-sidebar-workspace-create:disabled { cursor: not-allowed; opacity: .4; }

  .session-sidebar-cwd { min-width: 0; }
  .session-sidebar-cwd > summary { display: flex; min-width: 0; min-height: 32px; align-items: center; gap: 6px; padding: 5px; border-radius: 7px; color: var(--muted); font-size: 9.5px; font-weight: 560; cursor: pointer; list-style: none; user-select: none; }
  .session-sidebar-cwd > summary::-webkit-details-marker,
  .session-sidebar-child-sessions > summary::-webkit-details-marker,
  .session-archive-divider::-webkit-details-marker { display: none; }
  .session-sidebar-cwd > summary:hover { background: color-mix(in srgb, var(--text) 3%, transparent); color: var(--text); }
  .session-sidebar-cwd.current-cwd > summary { background: color-mix(in srgb, var(--accent) 3%, transparent); color: color-mix(in srgb, var(--accent) 18%, var(--text)); }
  .session-sidebar-cwd > summary::before { content: "›"; flex: none; font-size: 15px; line-height: .8; transition: transform .15s; }
  .session-sidebar-cwd[open] > summary::before { transform: rotate(90deg); }
  .session-sidebar-cwd-icon { width: 12px; height: 9px; flex: none; border: 1px solid currentColor; border-radius: 2px; opacity: .72; }
  .session-sidebar-cwd-icon::before { display: block; width: 5px; height: 2px; margin: -3px 0 0 1px; border: 1px solid currentColor; border-bottom: 0; border-radius: 2px 2px 0 0; background: var(--panel-2); content: ""; }
  .session-sidebar-cwd-label { min-width: 0; overflow: hidden; font-family: var(--mono); text-overflow: ellipsis; white-space: nowrap; }
  .session-sidebar-count,
  .session-sidebar-hit-count { min-width: 21px; margin-left: auto; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--text) 5%, transparent); color: var(--muted); font-size: 9px; text-align: center; }

  .session-sidebar-workspace-sessions,
  .session-sidebar-child-list { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
  .session-sidebar-cwd[open] > .session-sidebar-workspace-sessions { padding-top: 4px; }
  .session-sidebar-child-sessions { min-width: 0; margin-left: 17px; }
  .session-sidebar-child-sessions > summary { min-height: 30px; padding: 6px 5px; color: var(--muted); font-size: 10px; cursor: pointer; list-style: none; }
  .session-sidebar-child-sessions > summary::before { content: "▸ "; }
  .session-sidebar-child-sessions[open] > summary::before { content: "▾ "; }
  .session-sidebar-child-sessions > summary:hover { color: var(--text); }
  .session-sidebar-child-list { padding-left: 8px; }

  .session-sidebar-entry { position: relative; display: flex; min-height: 54px; align-items: center; gap: 2px; border: 1px solid transparent; border-radius: 9px; transition: background-color .14s, border-color .14s, transform .14s; }
  .session-sidebar-entry:hover { background: color-mix(in srgb, var(--text) 4.5%, transparent); transform: translateX(2px); }
  .session-sidebar-entry.current { border-color: color-mix(in srgb, var(--accent) 14%, var(--border)); background: color-mix(in srgb, var(--accent) 4%, var(--panel-2)); box-shadow: inset 1px 0 0 var(--selection-marker); }
  .session-sidebar-placeholder { display: flex; width: 100%; min-width: 0; min-height: 54px; align-items: center; gap: 8px; padding: 7px 9px; border: 1px dashed color-mix(in srgb, var(--accent) 25%, var(--border)); border-radius: 9px; background: color-mix(in srgb, var(--accent) 3%, transparent); color: var(--muted); font: inherit; text-align: left; cursor: pointer; transition: border-color .14s, background-color .14s, color .14s, transform .14s; }
  .session-sidebar-placeholder:hover { border-style: solid; border-color: color-mix(in srgb, var(--accent) 48%, var(--border)); background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--text); transform: translateX(2px); }
  .session-sidebar-placeholder:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 1px; }
  .session-sidebar-placeholder-icon { position: relative; display: grid; width: 22px; height: 22px; flex: none; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border)); border-radius: 50%; background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--accent); font-size: 0; }
  .session-sidebar-placeholder-icon::before,
  .session-sidebar-placeholder-icon::after { position: absolute; top: 50%; left: 50%; width: 10px; height: 1.5px; border-radius: 999px; background: currentColor; content: ""; transform: translate(-50%, -50%); }
  .session-sidebar-placeholder-icon::after { transform: translate(-50%, -50%) rotate(90deg); }
  .session-sidebar-placeholder .session-sidebar-name { color: color-mix(in srgb, var(--accent) 32%, var(--text)); }
  .session-sidebar-row { display: flex; min-width: 0; min-height: 54px; flex: 1; align-items: center; gap: 8px; padding: 7px 7px 7px 9px; border: 0; border-radius: 9px; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
  .session-sidebar-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
  .session-sidebar-name,
  .session-sidebar-folder,
  .session-sidebar-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-sidebar-name { font-size: 12.5px; font-weight: 580; }
  .session-sidebar-entry.current .session-sidebar-name { color: var(--selection-text); }
  .session-sidebar-folder { color: var(--muted); font: 10.5px var(--mono); }
  .session-sidebar-meta { color: var(--muted); font-size: 9.5px; font-weight: 450; }
  .s-dot { width: 6px; height: 6px; margin-right: 5px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 3%, transparent); }

  .session-sidebar-action,
  .session-sidebar-lifecycle { display: grid; width: 30px; height: 30px; flex: none; align-self: center; place-items: center; margin-right: 3px; padding: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--muted); line-height: 1; opacity: .72; cursor: pointer; transition: color .12s, background-color .12s, border-color .12s, opacity .12s; }
  .session-sidebar-action { font-size: 0; }
  .session-sidebar-action.stop::before { width: 11px; height: 11px; border-radius: 2px; background: currentColor; content: ""; }
  .session-sidebar-action.delete::before { width: 11px; height: 11px; background: currentColor; content: ""; clip-path: polygon(8% 0, 50% 42%, 92% 0, 100% 8%, 58% 50%, 100% 92%, 92% 100%, 50% 58%, 8% 100%, 0 92%, 42% 50%, 0 8%); }
  .session-sidebar-lifecycle.archive::before { width: 11px; height: 11px; border: 1.5px solid currentColor; border-top-width: 4px; border-radius: 2px; content: ""; }
  .session-sidebar-entry:hover :is(.session-sidebar-action, .session-sidebar-lifecycle),
  .session-sidebar-entry.current :is(.session-sidebar-action, .session-sidebar-lifecycle) { opacity: 1; }
  .session-sidebar-action:hover { border-color: color-mix(in srgb, var(--red) 28%, var(--border)); background: color-mix(in srgb, var(--red) 8%, transparent); color: var(--red); }
  .session-sidebar-lifecycle:hover { border-color: color-mix(in srgb, var(--accent) 28%, var(--border)); background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--accent); opacity: 1; }

  .session-loop-card { position: relative; display: flex; min-width: 0; min-height: 60px; align-items: center; overflow: hidden; border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border)); border-radius: 10px; background: color-mix(in srgb, var(--accent) 6%, var(--panel-2)); }
  .session-loop-card:hover { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
  .session-loop-header { display: flex; min-width: 0; min-height: 60px; flex: 1; align-items: center; gap: 8px; padding: 8px 7px 8px 9px; border: 0; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
  .session-loop-icon { display: grid; width: 27px; height: 27px; flex: none; place-items: center; border-radius: 8px; background: color-mix(in srgb, var(--accent) 13%, transparent); color: var(--accent); font-size: 17px; }
  .session-loop-copy { display: grid; min-width: 0; flex: 1; gap: 2px; }
  .session-loop-kicker { color: var(--muted); font-size: 8px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .session-loop-progress { flex: none; padding: 2px 6px; border: 1px solid color-mix(in srgb, var(--green) 24%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--green) 10%, transparent); color: var(--green); font-size: 8.5px; font-weight: 700; }
  .session-loop-progress.status-running { border-color: color-mix(in srgb, var(--accent) 28%, transparent); background: color-mix(in srgb, var(--accent) 13%, transparent); color: var(--accent); }
  .session-loop-progress.status-failed { border-color: color-mix(in srgb, var(--red) 28%, transparent); background: color-mix(in srgb, var(--red) 10%, transparent); color: var(--red); }
  .session-loop-chevron { width: 6px; height: 6px; flex: none; margin-right: 2px; border-right: 1.5px solid var(--muted); border-bottom: 1.5px solid var(--muted); transform: rotate(-45deg); transition: transform .15s; }
  .session-loop-header[aria-expanded="true"] .session-loop-chevron { transform: rotate(45deg); }
  .session-sidebar-loop-timeline { position: relative; display: flex; min-width: 0; flex-direction: column; gap: 3px; margin: 1px 0 7px 23px; padding-left: 13px; }
  .session-sidebar-loop-timeline::before { position: absolute; top: 17px; bottom: 17px; left: 3px; width: 2px; border-radius: 2px; background: color-mix(in srgb, var(--muted) 24%, transparent); content: ""; }
  .session-timeline-entry { min-height: 48px; }
  .session-timeline-entry .session-sidebar-row { min-height: 48px; padding-left: 4px; }
  .session-timeline-marker { position: relative; z-index: 1; width: 10px; height: 10px; flex: none; margin-right: 7px; margin-left: -19px; border: 2px solid var(--panel); border-radius: 50%; background: var(--muted); box-shadow: 0 0 0 2px color-mix(in srgb, var(--muted) 35%, transparent); }
  .session-timeline-entry.status-succeeded .session-timeline-marker { background: var(--green); box-shadow: 0 0 0 2px color-mix(in srgb, var(--green) 34%, transparent); }
  .session-timeline-entry.status-failed .session-timeline-marker { background: var(--red); box-shadow: 0 0 0 2px color-mix(in srgb, var(--red) 36%, transparent); }
  .session-timeline-entry.status-running .session-timeline-marker { background: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent); animation: session-timeline-glow 1.45s ease-in-out infinite; }

  .session-sidebar-status { padding: 6px 3px; color: var(--muted); font-size: 11px; }
  .session-sidebar-hit-group { display: flex; min-width: 0; flex: none; flex-direction: column; overflow: hidden; border: 1px solid var(--border); border-radius: 10px; background: color-mix(in srgb, var(--text) 3%, var(--panel)); }
  .session-sidebar-hit-heading { display: flex; align-items: center; gap: 8px; padding: 8px 8px 0; }
  .session-sidebar-hit-heading .session-sidebar-name { min-width: 0; flex: 1; }
  .session-sidebar-hit-group > .session-sidebar-folder { padding: 2px 8px 8px; overflow: visible; overflow-wrap: anywhere; line-height: 1.3; text-overflow: clip; white-space: normal; }
  .session-sidebar-hit-list { display: grid; border-top: 1px solid var(--border); }
  .session-sidebar-hit { width: 100%; height: 72px; min-width: 0; padding: 7px 8px; border: 0; border-bottom: 1px solid var(--border); background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: background-color .14s; }
  .session-sidebar-hit:last-child { border-bottom: 0; }
  .session-sidebar-hit:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .session-sidebar-snippet { width: 100%; min-width: 0; color: var(--muted); font-size: 11px; line-height: 1.4; --search-hit-lines: 3; }

  .session-sidebar-archive { min-width: 0; }
  .session-archive-divider { display: flex; min-height: 34px; align-items: center; gap: 7px; margin: 8px 4px 2px; padding-top: 8px; border-top: 1px solid var(--border); color: var(--muted); font-size: 9px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; cursor: pointer; list-style: none; user-select: none; }
  .session-archive-divider::before { color: var(--muted); font-size: 15px; line-height: .8; content: "›"; transition: transform .15s; }
  .session-sidebar-archive[open] > .session-archive-divider::before { transform: rotate(90deg); }
  .session-archive-divider small { margin-left: auto; color: var(--muted); font-size: 8px; font-weight: 550; letter-spacing: .04em; text-transform: none; }
  .session-sidebar-archive-groups { display: flex; flex-direction: column; gap: 6px; padding-top: 4px; }

  :is(.r-empty, .session-sidebar-workspace-empty) { overflow-wrap: anywhere; }
  .r-empty { padding: 16px 8px; border: 1px dashed var(--border); border-radius: 9px; color: var(--muted); font-size: 11px; text-align: center; }

  @keyframes workspace-pulse { 50% { opacity: .45; } }
  @keyframes session-timeline-glow { 50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent), 0 0 12px 3px color-mix(in srgb, var(--accent) 30%, transparent); } }

  @media (max-width: 760px) {
    #sessions { padding: max(18px, env(safe-area-inset-top)) max(14px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left)); }
    .session-sidebar-search { height: 42px; }
    .session-sidebar-create,
    .session-sidebar-environment-control { min-height: 44px; }
    .session-sidebar-create-folder,
    .session-sidebar-environment-create { width: var(--icon-control-important); }
    .session-sidebar-environment-info { width: var(--icon-control-standard); }
    .session-sidebar-entry,
    .session-sidebar-row,
    .session-sidebar-placeholder { min-height: 58px; }
    .session-sidebar-action,
    .session-sidebar-lifecycle { width: var(--icon-control-standard); height: var(--icon-control-standard); }
    .session-sidebar-cwd > summary,
    .session-sidebar-child-sessions > summary,
    .session-archive-divider,
    .session-sidebar-load-more,
    .session-sidebar-environment-empty-create { min-height: 40px; }
  }

  @media (max-width: 520px) {
    .session-sidebar-instance-tooltip { right: 0; left: auto; width: min(320px, calc(100vw - 28px)); }
    .session-sidebar-instance-tooltip dl { grid-template-columns: minmax(0, 1fr); }
    .session-sidebar-instance-tooltip dl div { border-right: 0; }
    .session-sidebar-instance-tooltip dl div:nth-child(2) { border-top: 1px solid var(--border); }
  }

  @media (pointer: coarse) {
    .session-sidebar-workspace-cloud-actions { gap: 12px; margin-right: 5px; }
    .session-sidebar-workspace-power,
    .session-sidebar-workspace-destroy,
    .session-sidebar-workspace-create { position: relative; }
    .session-sidebar-workspace-power::after,
    .session-sidebar-workspace-destroy::after { position: absolute; inset: -8px -6px; content: ""; }
    .session-sidebar-workspace-create::after { position: absolute; inset: -6px; content: ""; }
  }

  @media (prefers-reduced-motion: reduce) {
    .session-sidebar-workspace-icon,
    .session-timeline-entry.status-running .session-timeline-marker { animation: none; }
    .session-sidebar-entry:hover,
    .session-sidebar-placeholder:hover { transform: none; }
  }
</style>
