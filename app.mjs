/** Hot-reloadable HTTP application composition. Durable state remains owned by server.mjs. */

import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// sibling modules are imported with a cache-busting query so hot reloads of
// app.mjs pick up their current versions instead of stale cached modules
const __dirname = dirname(fileURLToPath(import.meta.url));
const bust = (name) => `./${name}?v=${statSync(join(__dirname, name)).mtimeMs}`;

export async function init(state) {
  const { listTunnels, openTunnel, closeTunnel, closeAllTunnels, spawnHublotAgent } =
    await import(bust("tunnels.mjs"));
  
  const { listRoutines, createRoutine, deleteRoutine, startRoutine, stopRoutine, teardownRoutine, releaseRoutine, releaseSessionRoutines, stopAllRoutines, routinesDir } =
    await import(bust("routines.mjs"));
  
  const {
    SESSIONS_ROOT, forkSessionAt, readSessionHeaderInfo,
    sessionFileParam, sessionFileFromSearch, sessionCatalog: jsonlSessionCatalog,
  } = await import(bust("sessions.mjs"));
  
  const { loadCheckpoints, saveCheckpoints, recordCheckpoint, checkpointTree, git, checkpointWorkdir } =
    await import(bust("checkpoints.mjs"));
  
  const { createRunnerManager } = await import(bust("runners.mjs"));
  const { createSessionReferenceCodec, createSessionRequestResolver } = await import(bust("session-references.mjs"));

  const [
    { createRequestContext }, { createRouteTable },
    { createOpenRoutes }, { createStaticRoutes }, { createRunnerRoutes },
    { createSessionRoutes }, { createFileRoutes }, { createWorkdirRoutes },
    { createTunnelRoutes }, { createRoutineRoutes }, { createCheckpointRoutes },
  ] = await Promise.all([
    "http/createRequestContext.mjs", "http/createRouteTable.mjs",
    ...[
      "openRoutes", "staticRoutes", "runnerRoutes", "sessionRoutes", "fileRoutes",
      "workdirRoutes", "tunnelRoutes", "routineRoutes", "checkpointRoutes",
    ].map((name) => `http/routes/${name}.mjs`),
  ].map((name) => import(bust(name))));
  const { config } = state;

  // ---- state migrations --------------------------------------------------
  // The core (server.mjs) only changes on a real restart; state it created
  // under an OLDER core version is patched here so fixes apply on hot reload
  // too. Each migration must be idempotent.
  if (state.eventBuffer) {
    // pre-runner era: global server events were buffered but never replayed
    // (per-runner replay lives in runner.buffer). Drop the dead buffer and
    // swap in the non-buffering broadcast with dead-client guards.
    delete state.eventBuffer;
    state.broadcast = (line) => {
      for (const res of state.sseClients) {
        if (!res.writableEnded && !res.destroyed) res.write(`data: ${line}\n\n`);
      }
    };
    console.log("[pi-ui] migrated state: removed dead eventBuffer, patched broadcast");
  }

  const catalogKey = `${config.PERSISTENT_STORE}:${config.SQLITE_PATH ?? SESSIONS_ROOT}`;
  if (state.sessionCatalogKey !== catalogKey) {
    state.sessionCatalog?.close?.();
    state.sessionCatalog = config.PERSISTENT_STORE === "sqlite"
      ? (await import(bust("sessions/sqliteCatalog.mjs"))).createSqliteSessionCatalog({ databasePath: config.SQLITE_PATH })
      : jsonlSessionCatalog;
    state.sessionCatalogKey = catalogKey;
  }
  state.sessionReferences = createSessionReferenceCodec({
    agentDir: config.PI_AGENT_DIR ?? dirname(SESSIONS_ROOT),
    jsonlRoot: SESSIONS_ROOT,
    sqlitePath: config.SQLITE_PATH ?? undefined,
  });
  const runners = createRunnerManager(state);
  const {
    srvId, runnerInfo, listRunnerInfo, runnersChanged,
    spawnRunner, startRunner, stopRunner, sendToRunner,
    runnerFromReq, openSessionRunner, startPi, stopPi,
  } = runners;

  // ---------------------------------------------------------------- request context

  const requestContext = createRequestContext(state);
  const {
    json, clientIp, checkAuth,
  } = requestContext;

  // ---------------------------------------------------------------- routes (no auth)

  const openRoutes = createOpenRoutes({ state, listRunnerInfo, requestContext });
  const staticRoutes = createStaticRoutes({ config, requestContext });
  const {
    referenceFor: sessionReferenceFor,
    targetFromSearch: sessionTargetFromSearch,
    referenceParam: sessionReferenceParam,
  } = createSessionRequestResolver({
    codec: state.sessionReferences,
    sessionFileParam,
    sessionFileFromSearch,
    readSessionHeaderInfo,
  });
  const runnerRoutes = createRunnerRoutes({
    state, requestContext, runnerFromReq, startRunner, listRunnerInfo,
    sendToRunner, stopRunner, runnerInfo, openSessionRunner,
    sessionReferenceParam, srvId, runnersChanged,
  });
  const fileRoutes = createFileRoutes({ state, requestContext });
  const workdirRoutes = createWorkdirRoutes({ state, requestContext, spawnRunner, runnerInfo });
  const tunnelRoutes = createTunnelRoutes({
    state, config, requestContext, listTunnels, openTunnel, closeTunnel,
    spawnHublotAgent,
  });
  const checkpointRoutes = createCheckpointRoutes({
    state, config, requestContext, runnerFromReq, checkpointWorkdir,
    recordCheckpoint, loadCheckpoints, checkpointTree, sessionFileParam: sessionTargetFromSearch,
    git, saveCheckpoints, forkSessionAt, openSessionRunner, sendToRunner,
    srvId, runnerInfo,
  });
  const routineRoutes = createRoutineRoutes({
    state, requestContext,
    routines: {
      listRoutines, routinesDir, createRoutine, startRoutine, stopRoutine,
      teardownRoutine, releaseRoutine, deleteRoutine,
    },
  });
  const sessionRoutes = createSessionRoutes({
    state,
    requestContext,
    sessions: {
      catalog: state.sessionCatalog,
      readSessionHeaderInfo,
      sessionReferenceFor,
      sessionTargetFromSearch,
    },
    runners: { stopRunner, runnersChanged },
    resources: { closeTunnel, releaseSessionRoutines },
  });

  const routeTable = createRouteTable({ static: staticRoutes, open: openRoutes, runner: runnerRoutes, session: sessionRoutes, file: fileRoutes, workdir: workdirRoutes, tunnel: tunnelRoutes, routine: routineRoutes, checkpoint: checkpointRoutes });
  const openRouteKeys = new Set(Object.keys(openRoutes));

  // ---------------------------------------------------------------- dispatch

  async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const key = `${req.method} ${url.pathname}`;

    const staticFallback = routeTable.get(`${req.method} /*`);
    if (staticFallback?.(req, res, url)) return;

    const open = openRouteKeys.has(key) ? routeTable.get(key) : undefined;
    if (open) return open(req, res, url);

    // everything below requires auth
    // EXCEPT: tunnel/hublot operations from localhost. The hublot tool runs on
    // this same machine (it's the local proxy between agent sessions and the
    // server) and has no way to pass a bearer token — it authenticates by
    // virtue of being able to reach the loopback port. Per-session isolation
    // (tunnels are bound to a sessionId) is the real access control here.
    const isLocal = (() => {
      const ip = clientIp(req);
      return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
    })();
    const isLocalRoute = url.pathname === "/tunnels" || url.pathname === "/routines";
    const auth = (isLocal && isLocalRoute) ? "ok" : checkAuth(req, url);
    if (auth !== "ok") {
      if (auth === "throttled") json(res, 429, { error: "too many auth failures — try again later" });
      else json(res, 401, { error: "unauthorized" });
      return;
    }

    const route = routeTable.get(key);
    if (route) return route(req, res, url);

    // same path exists under another method -> 405, otherwise 404
    const pathKnown = [...routeTable.keys()].some((k) => k.endsWith(` ${url.pathname}`));
    json(res, pathKnown ? 405 : 404, { error: pathKnown ? "method not allowed" : "not found" });
  }

  return {
    handleRequest, startPi, stopPi,
    stopTunnels: () => closeAllTunnels(state),
    stopRoutines: () => stopAllRoutines(state),
  };
}
