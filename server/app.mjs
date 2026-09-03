/** Hot-reloadable HTTP application composition. Durable state remains owned by server.mjs. */
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCandidateState, createDisposableScope, createRequestLifecycle,
  validateCatalogAccess, validateDependencyConstruction, validateRepositoryAvailability,
} from "./application-candidate.mjs?reload=1";
// Include nanosecond mtime and size so rapid same-tick saves cannot reuse a stale ESM entry.
const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleVersion = (name) => { const info = statSync(join(__dirname, name), { bigint: true }); return `${info.mtimeNs}-${info.size}`; };
const bust = (name) => `./${name}?v=${moduleVersion(name)}`;
export async function buildCandidate(stableState, { generation = Symbol("application-candidate") } = {}) {
  const { listTunnels, allocateHublot, reserveHublot, recordHublotTransition, rebindHublot, recoverAnsweringHublotService, restartHublotService, localPortAnswers, openTunnel, closeTunnel, closeSessionHublots, shutdownHublots, spawnHublotAgent, spawnGitServerService, ensureHublotTunnelPool, acquireHublotTunnelPoolEntry, activateHublotTunnelPoolEntry, stopHublotTunnelPool } =
    await import(bust("tunnels.mjs"));
  const { listRoutines, createRoutine, deleteRoutine, startRoutine, stopRoutine, teardownRoutine, releaseRoutine, stopSessionRoutines, deleteSessionRoutines, stopAllRoutines, routinesDir, spawnRoutineAgent } =
    await import(bust("routines.mjs"));
  const {
    SESSIONS_ROOT, forkSessionAt, readSessionHeaderInfo,
    sessionFileParam, sessionFileFromSearch, sessionCatalog: jsonlSessionCatalog,
  } = await import(bust("sessions.mjs"));
  const { recordCheckpoint, checkpointTree, git, checkpointWorkdir } =
    await import(bust("checkpoints.mjs"));
  const { createRunnerManager } = await import(bust("runners.mjs"));
  const { createConfiguredRunnerDrivers } = await import(bust("runner-drivers/configured.mjs")); const { createClaudeTranscriptSink } = await import(bust("persistence/claudeTranscriptSink.mjs"));
  const { createSessionReferenceCodec, createSessionRequestResolver } = await import(bust("session-references.mjs"));
  const { createSessionOperations } = await import(bust("session-operations.mjs"));
  const { createPiCredentialService } = await import(bust("pi-credential-service.mjs")); const { createClaudeOAuthCredentialSink } = await import(bust("claude-oauth-credential-sink.mjs")); const { createPiOAuthFlowService } = await import(bust("pi-oauth-flow-service.mjs")); const { createRestartActiveRunners } = await import(bust("runner-restart-service.mjs"));
  const { createSessionOwnerResolver } = await import(bust("persistence/sessionOwners.mjs")); const { createSessionDeletionWorkflow } = await import(bust("persistence/sessionDeletion.mjs"));
  const { reconcileSessionDeletions } = await import(bust("persistence/sessionDeletionReconciler.mjs")); const { createCheckpointRollbackJournal } = await import(bust("persistence/checkpointRollbackJournal.mjs"));
  const { createPiProcessLauncher } = await import(bust("pi-processes.mjs")); const { createHublotSupervisor, scheduleHublotStartupReconciliation } = await import(bust("persistence/hublotSupervisor.mjs"));
  const { createPinnedWidgetRoutes, ensurePinnedHublot } = await import(bust("pinned-widgets.mjs"));
  const { createWebPushService } = await import(bust("web-push-service.mjs"));
  const [
    { createRequestContext }, { createRouteTable },
    { createOpenRoutes }, { createStaticRoutes }, { createRunnerRoutes },
    { createSessionRoutes, setSessionFamilyArchived, stopSessionFamilyRunners }, { createFileRoutes }, { createWorkdirRoutes },
    { createTunnelRoutes }, { createRoutineRoutes }, { createCheckpointRoutes },
    { createCredentialRoutes }, { createOAuthRoutes }, { createPushRoutes },
  ] = await Promise.all([
    "http/createRequestContext.mjs", "http/createRouteTable.mjs",
    ...[
      "openRoutes", "staticRoutes", "runnerRoutes", "sessionRoutes", "fileRoutes",
      "workdirRoutes", "tunnelRoutes", "routineRoutes", "checkpointRoutes", "credentialRoutes", "oauthRoutes", "pushRoutes",
    ].map((name) => `http/routes/${name}.mjs`),
  ].map((name) => import(bust(name))));

  const scope = createDisposableScope({ generation });
  const requests = createRequestLifecycle();
  let application = null;
  let activation = null;
  let disposal = null;
  let disposed = false;
  async function activate() {
    if (disposed) throw new Error("candidate application is disposed");
    if (application) return application;
    if (activation) return activation;
    activation = (async () => {
      const state = createCandidateState(stableState);
      try {
  const { config, appStore } = state;
  const hydratedStore = await validateRepositoryAvailability(appStore);
  const checkpointRepository = appStore.repositories.checkpoints;

  // Patch state created by an older stable core; migrations are idempotent.
  if (state.eventBuffer) {
    delete state.eventBuffer;
    state.broadcast = (line) => {
      for (const res of state.sseClients) {
        if (!res.writableEnded && !res.destroyed) res.write(`data: ${line}\n\n`);
      }
    };
    console.log("[oyster] migrated state: removed dead eventBuffer, patched broadcast");
  }

  const catalogModule = config.PERSISTENT_STORE === "sqlite" ? "sessions/sqliteCatalog.mjs" : "sessions.mjs"; const catalogKey = `${config.PERSISTENT_STORE}:${config.SQLITE_PATH ?? SESSIONS_ROOT}:${moduleVersion(catalogModule)}`;
  state.sessionCatalog = config.PERSISTENT_STORE === "sqlite"
    ? (await import(bust(catalogModule))).createSqliteSessionCatalog({ databasePath: config.SQLITE_PATH })
    : jsonlSessionCatalog;
  state.sessionCatalogKey = catalogKey;
  if (config.PERSISTENT_STORE === "sqlite") {
    const candidateCatalog = state.sessionCatalog;
    scope.defer(() => candidateCatalog.close?.());
  }
  await validateCatalogAccess(state.sessionCatalog, {
    backend: config.PERSISTENT_STORE ?? "jsonl",
    cwd: config.PI_DIR,
  });
  state.sessionReferences = createSessionReferenceCodec({
    agentDir: config.PI_AGENT_DIR ?? dirname(SESSIONS_ROOT),
    jsonlRoot: SESSIONS_ROOT,
    sqlitePath: config.SQLITE_PATH ?? undefined,
  });
  state.piProcesses = createPiProcessLauncher({ config }); if (!state.hublotSupervisor) state.hublotSupervisor = createHublotSupervisor({ appStore, recordTransition: (id, status, options) => recordHublotTransition(state, id, status, options), recoverTunnel: (hublot) => recoverAnsweringHublotService(state, hublot), checkService: (hublot) => localPortAnswers(hublot.port), restartService: (hublot) => restartHublotService(state, hublot) });
  state.sessionOperations = createSessionOperations({ config, appStore, sessionReferences: state.sessionReferences });
  if (!state.sessionDeletionReconciled) {
    state.sessionDeletionReconciliation = await reconcileSessionDeletions({ appStore, sessionReferences: state.sessionReferences, sessionCatalog: state.sessionCatalog, sessionOperations: state.sessionOperations, closeSessionHublots: (id) => closeSessionHublots(state, id), deleteSessionRoutines: (id) => deleteSessionRoutines(state, id) });
    state.incompleteOperations = new Map(hydratedStore.incompleteOperations.map((entry) => [entry.id, entry]));
    state.sessionDeletionReconciled = true;
  }
  const ensureSessionOwner = createSessionOwnerResolver({ appStore, sessionReferences: state.sessionReferences,
    sessionCatalog: state.sessionCatalog, runners: () => state.runners?.values() ?? [] });
  const deleteOwnedSession = createSessionDeletionWorkflow({ appStore, ensureSessionOwner });
  const checkpointRollbackJournal = createCheckpointRollbackJournal({ appStore, ensureSessionOwner });
  const webPushService = await createWebPushService({ repository: appStore.repositories.webPush });
  const runnerDrivers = createConfiguredRunnerDrivers({ config, piProcesses: state.piProcesses });
  const claudeTranscriptSink = config.CLAUDE_CODE_BIN && config.SQLITE_PATH ? createClaudeTranscriptSink({ projectsDir: config.CLAUDE_CODE_PROJECTS_DIR, sqlitePath: config.SQLITE_PATH, piBin: config.PI_BIN }) : null;
  const runners = await createRunnerManager(state, { appStore, ensureSessionOwner, notifyRunnerEvent: webPushService.handleRunnerEvent, unarchiveSession: (rootReference) => setSessionFamilyArchived({ state, catalog: state.sessionCatalog, rootReference, archived: false, includeAncestors: true }), runnerDrivers, guardCallback: scope.guard });
  const {
    srvId, runnerInfo, listRunnerInfo, replayRunnerEvents, runnersChanged,
    spawnRunner, startRunner, stopRunner, sendToRunner, observeRunner, acknowledgeRunnerAttention,
    runnerFromReq, openSessionRunner, updateRunnerSessionReference, startPi, stopPi,
  } = runners;
  validateDependencyConstruction({
    sessionReferences: { value: state.sessionReferences, methods: ["validate", "serialize"] },
    sessionOperations: { value: state.sessionOperations, methods: ["deleteSession", "forkSession"] },
    piProcesses: { value: state.piProcesses, methods: ["launch", "ephemeral"] },
    runnerDrivers: { value: runnerDrivers, methods: ["get", "has", "compatible", "list"] },
    runnerManager: { value: runners, methods: ["startRunner", "stopRunner", "runnerFromReq", "updateRunnerSessionReference", "startPi", "stopPi"] },
  });
  const watchdogTimer = state.runnerWatchdogTimer;
  const reaperTimer = state.runnerReaperTimer;
  scope.defer(() => { clearInterval(reaperTimer); clearInterval(watchdogTimer); });
  const requestContext = createRequestContext(state);
  const {
    json, checkAuth,
  } = requestContext;
  const openRoutes = createOpenRoutes({ state, listRunnerInfo, runnerHarnesses: () => runnerDrivers.list(), requestContext });
  const staticRoutes = createStaticRoutes({ config, requestContext });
  const {
    referenceFor: sessionReferenceFor,
    targetFromSearch: sessionTargetFromSearch,
    referenceFromSearch: sessionReferenceFromSearch,
    referenceParam: sessionReferenceParam,
  } = createSessionRequestResolver({
    codec: state.sessionReferences,
    sessionFileParam,
    sessionFileFromSearch,
    readSessionHeaderInfo,
  });
  const runnerRoutes = createRunnerRoutes({
    state, appStore, requestContext, runnerFromReq, startRunner, listRunnerInfo,
    sendToRunner, acknowledgeRunnerAttention, stopRunner, stopRunnerFamily: (rootRunner) => stopSessionFamilyRunners({ state, catalog: state.sessionCatalog, rootRunner, stopRunner }),
    spawnRunner, observeRunner, runnerInfo, replayRunnerEvents, openSessionRunner, sessionReferenceParam,
    runnerHarnesses: () => runnerDrivers.list(),
    syncClaudeTranscript: (options) => { if (!claudeTranscriptSink) throw new Error("Claude transcript sink requires the SQLite session store"); return claudeTranscriptSink.sync(options); },
    updateRunnerSessionReference,
    lookupSessionReference: async (reference) => reference.backend === state.sessionCatalog.backend
      ? await state.sessionCatalog.findById(reference.id)
      : null,
  });
  const fileRoutes = createFileRoutes({ state, requestContext });
  const workdirRoutes = createWorkdirRoutes({ state, appStore, requestContext, spawnRunner, runnerInfo });
  const tunnelRoutes = createTunnelRoutes({
    state, appStore, config, requestContext, listTunnels, allocateHublot, reserveHublot, recordHublotTransition, rebindHublot, openTunnel, closeTunnel,
    acquireHublotTunnelPoolEntry, activateHublotTunnelPoolEntry,
    spawnHublotAgent, spawnGitServerService, ensureSessionOwner,
    pinHublot: (hublot) => ensurePinnedHublot(state, hublot),
  });
  const pinnedWidgetRoutes = createPinnedWidgetRoutes({ state, requestContext, ensureSessionOwner, listTunnels });
  const claudeOAuthCredentialSink = config.CLAUDE_CODE_BIN ? createClaudeOAuthCredentialSink({ configDir: config.CLAUDE_CONFIG_DIR }) : null;
  const credentialService = createPiCredentialService({ config, claudeOAuthCredentialSink });
  const restartActiveRunners = createRestartActiveRunners({ runners: () => state.runners, stopRunner, startRunner });
  const credentialRoutes = createCredentialRoutes({ requestContext, credentialService, restartActiveRunners });
  state.oauthFlows ??= new Map(); const oauthRegistry = new Map(); state.oauthFlows.set(generation, oauthRegistry); scope.defer(() => state.oauthFlows.delete(generation));
  const oauthFlowService = createPiOAuthFlowService({ registry: oauthRegistry, credentialService, restartActiveRunners, setTimer: (callback, delay) => setTimeout(scope.guard(callback), delay) }); scope.defer(() => oauthFlowService.shutdown()); const oauthRoutes = createOAuthRoutes({ requestContext, credentialService, flowService: oauthFlowService, restartActiveRunners });
  const checkpointRoutes = createCheckpointRoutes({
    state, appStore, config, requestContext, runnerFromReq, checkpointWorkdir,
    recordCheckpoint, checkpointRepository, checkpointRollbackJournal, checkpointTree, sessionReferenceFromSearch, ensureSessionOwner,
    git, forkSessionAt, openSessionRunner, sendToRunner,
    srvId, runnerInfo,
  });
  const routineRoutes = createRoutineRoutes({
    state, appStore, requestContext, ensureSessionOwner,
    routines: {
      listRoutines, routinesDir, createRoutine, startRoutine, stopRoutine,
      teardownRoutine, releaseRoutine, deleteRoutine, spawnRoutineAgent,
    },
  });
  const pushRoutes = createPushRoutes({ requestContext, pushService: webPushService });
  const sessionRoutes = createSessionRoutes({
    state,
    appStore,
    requestContext,
    sessions: {
      catalog: state.sessionCatalog,
      readSessionHeaderInfo,
      sessionReferenceFor,
      sessionTargetFromSearch,
    },
    runners: { stopRunner, runnersChanged },
    resources: { closeTunnel, closeSessionHublots, listTunnels, stopSessionRoutines, deleteSessionRoutines },
    sessionOperations: state.sessionOperations,
    deleteOwnedSession,
  });

  const routeTable = createRouteTable({ static: staticRoutes, open: openRoutes, runner: runnerRoutes, session: sessionRoutes, file: fileRoutes, workdir: workdirRoutes, tunnel: tunnelRoutes, pinnedWidget: pinnedWidgetRoutes, routine: routineRoutes, checkpoint: checkpointRoutes, credential: credentialRoutes, oauth: oauthRoutes, push: pushRoutes });
  const openRouteKeys = new Set(Object.keys(openRoutes)); const knownPaths = new Set([...routeTable.keys()].map((key) => key.slice(key.indexOf(" ") + 1)));

  // ---------------------------------------------------------------- dispatch
  async function handleRequest(req, res) {
    let url; try { url = new URL(req.url ?? "/", "http://localhost"); }
    catch { json(res, 400, { error: "invalid request URL" }); return; }
    const key = `${req.method} ${url.pathname}`;

    const staticFallback = routeTable.get(`${req.method} /*`);
    if (staticFallback?.(req, res, url)) return;

    const open = openRouteKeys.has(key) ? routeTable.get(key) : undefined;
    if (open) return open(req, res, url);

    // Every privileged route requires an explicit credential. Loopback is not
    // an authentication boundary: same-host reverse proxies make remote
    // requests appear to originate from 127.0.0.1.
    const auth = checkAuth(req, url);
    if (auth !== "ok") {
      if (auth === "throttled") json(res, 429, { error: "too many auth failures — try again later" });
      else json(res, 401, { error: "unauthorized" });
      return;
    }

    const route = routeTable.get(key);
    if (route) return route(req, res, url);

    // same path exists under another method -> 405, otherwise 404
    const pathKnown = knownPaths.has(url.pathname);
    json(res, pathKnown ? 405 : 404, { error: pathKnown ? "method not allowed" : "not found" });
  }

  const hublotReconciliation = scheduleHublotStartupReconciliation({ state, supervisor: state.hublotSupervisor });
  if (config.HUBLOT_TUNNEL_POOL_SIZE > 0 && !state.hublotTunnelPoolStopping) {
    void Promise.resolve(hublotReconciliation)
      .then(scope.guard(() => ensureHublotTunnelPool(state)))
      .catch((error) => console.error(`[oyster] initial tunnel pool failed: ${error instanceof Error ? error.message : String(error)}`));
  }
  application = {
    handleRequest, startPi, stopPi,
    stopTunnels: () => { stopHublotTunnelPool(state); state.hublotSupervisor?.stop(); return shutdownHublots(state); },
    stopRoutines: () => stopAllRoutines(state), stopOAuth: () => oauthFlowService.shutdown(),
  };
  return application;
      } catch (error) {
        disposed = true;
        await scope.dispose().catch((cleanupError) => { error.cleanupError = cleanupError; });
        throw error;
      }
    })();
    return activation;
  }
  return {
    activate,
    handleRequest: (...args) => {
      if (!application) throw new Error("candidate application is not active");
      return requests.handle(application.handleRequest, args);
    },
    dispose: () => {
      disposed = true; return disposal ??= requests.retire().then(() => scope.dispose()).catch((error) => { disposal = null; throw error; });
    },
    generation, get startPi() { return application?.startPi; },
    get stopPi() { return application?.stopPi; },
    get stopTunnels() { return application?.stopTunnels; },
    get stopRoutines() { return application?.stopRoutines; },
    get stopOAuth() { return application?.stopOAuth; },
  };
}
/** Compatibility entry point for embedders; stable core uses buildCandidate(). */
export async function init(state) {
  const candidate = await buildCandidate(state); await candidate.activate(); return candidate;
}
