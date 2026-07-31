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
        <span class="session-timeline-marker" aria-label={loopStatusLabel(timelineStatus)}></span>
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

{#snippet SessionRows({ families, archived = false, cwd = "", listKey = cwd })}
  {@const familyPage = collectionPage(families, collectionLimits, `families:${listKey}`)}
  <div class="session-sidebar-workspace-sessions">
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
    {@render SessionRows({ families: group.families, archived, cwd: group.cwd, listKey: cwdExpansionKey(group) })}
  </details>
{/snippet}

{#snippet SearchGroups({ groups, listKey })}
  {@const groupPage = collectionPage(groups, collectionLimits, `search:${listKey}`, SEARCH_GROUP_PAGE_SIZE)}
  {#each groupPage.items as group (group.sessionKey)}
    {@const hitPage = collectionPage(group.hits, collectionLimits, `search-hits:${group.sessionKey}`, SEARCH_HIT_PAGE_SIZE)}
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
