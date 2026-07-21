/**
 * pi-lot-ui — hot-reloadable application logic (composition root + router)
 *
 * Loaded by server.mjs (the stable core) via dynamic import. Everything here
 * can be edited while the server runs; the core re-imports this module on
 * change and swaps the handler atomically. All state that must survive a
 * reload (pi processes, SSE clients, buffers, config) lives in the `state`
 * object owned by the core — this module only reads/writes it.
 *
 * The domain logic lives in sibling modules, each imported with a
 * cache-busting query so hot reloads of app.mjs pick up their current
 * versions too (edit a sibling, then touch app.mjs to reload):
 *   runners.mjs     – one pi process per open session
 *   sessions.mjs    – session .jsonl parsing (mtime-cached), search, forking
 *   checkpoints.mjs – git checkpoints, rollback forks, commit summaries
 *   tunnels.mjs     – cloudflared tunnels + background hublot agents
 *   routines.mjs    – runnable scripts with progress reporting
 *
 * This file owns: auth (token + rate limiting), filesystem confinement,
 * HTTP helpers, and the route table. Handlers are `(req, res, url)` and are
 * looked up by "METHOD /path"; `openRoutes` skip auth.
 *
 * Routes:
 *   GET  /            -> static UI (public/index.html)              (no auth)
 *   GET  /s/<sessionId>[/m/<entryId>] -> same UI; the client opens that
 *                        session (and scrolls to the message)        (no auth)
 *   GET  /health      -> liveness probe                             (no auth)
 *   GET  /authcheck   -> which credentials arrived + validity       (no auth)
 *   GET  /events      -> SSE stream of one runner's stdout (?runner=id)
 *   POST /rpc         -> JSON command forwarded to a runner (?runner=id)
 *   GET  /runners     -> list live pi runners (one process per session)
 *   DELETE /runners   -> stop a runner (?id=…)
 *   POST /open-session -> get-or-spawn a runner { sessionPath?, dir? }
 *   GET  /sessions    -> saved pi sessions for the active workdir
 *   DELETE /session   -> delete a session file (?path=…)
 *   GET  /session-by-id -> locate a session file from its session id (?id=…)
 *   GET  /session-entries -> ordered user/assistant entries of the active
 *                          branch of one session (?path=…) — permalink anchors
 *   GET  /session-messages -> full message objects of the active branch
 *                          (?path=…) — instant transcript preview, read from
 *                          the cached session file (no pi round trip)
 *   GET  /session-folders -> all folders under ~/.pi/agent/sessions
 *   GET  /search      -> full-text search (?q=…&scope=session|folder|all[&path=…][&tools=1])
 *                        — only user/assistant text by default; tools=1 also
 *                        searches tool calls and thinking blocks
 *   GET  /browse      -> list subdirectories for the folder picker
 *   GET  /file-download, /file-content, POST /file-save, /file-upload
 *                     -> built-in file explorer (confined, see below)
 *   POST /workdir     -> switch folder (spawns a new runner there)
 *   POST /mkdir       -> create a subdirectory (folder picker "new folder")
 *   POST /restart     -> kill and respawn one runner (?runner=id)
 *   POST /checkpoint  -> commit all workdir changes of a runner (?runner=id)
 *                        { label?, model? } — git add -A && git commit in
 *                        runner.dir; with `model`, a one-shot pi sub-agent
 *                        summarizes the staged diff into the commit message.
 *                        The commit is recorded as a checkpoint anchored to
 *                        the session's latest message
 *   GET  /checkpoints -> checkpoint records of one session (?id=<sessionId>)
 *   GET  /checkpoint-tree -> the session family (root ancestor + all forks) of
 *                        one session as a tree, checkpoints attached (?path=…)
 *   POST /rollback    -> { sessionId, hash, model? } — deterministically
 *                        restore the workdir to that checkpoint (pending
 *                        changes are auto-committed first — summarized by a
 *                        sub-agent when `model` is given — then git reset
 *                        --hard) and open a forked session at that entry
 *   GET  /tunnels     -> live tunnels spawned by this server
 *   POST /tunnels     -> open a tunnel { port, label?, sessionId?, brief? }
 *   PATCH /tunnels    -> rebind a tunnel to another session { id, sessionId }
 *   DELETE /tunnels   -> close a tunnel (?id=…)
 *   GET  /routines    -> runnable scripts in ~/.pi/routines/ (+ live state & session bindings)
 *   POST /routines    -> { name, action: "create" | "start" | "stop" | "teardown" | "release" | "delete",
 *                          sessionId?, script? (create only) }
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// sibling modules are imported with a cache-busting query so hot reloads of
// app.mjs pick up their current versions instead of stale cached modules
const __dirname = dirname(fileURLToPath(import.meta.url));
const bust = (name) => `./${name}?v=${statSync(join(__dirname, name)).mtimeMs}`;

const { listTunnels, openTunnel, closeTunnel, closeAllTunnels, spawnHublotAgent } =
  await import(bust("tunnels.mjs"));

const { listRoutines, createRoutine, deleteRoutine, startRoutine, stopRoutine, teardownRoutine, releaseRoutine, releaseSessionRoutines, stopAllRoutines, routinesDir } =
  await import(bust("routines.mjs"));

const {
  SESSIONS_ROOT, sessionDirFor, summarizeSessionFile, listSessions, listSessionFolders,
  searchSessions, sessionEntries, sessionMessages, findSessionById, forkSessionAt,
  readSessionHeaderInfo,
} = await import(bust("sessions.mjs"));

const { loadCheckpoints, saveCheckpoints, recordCheckpoint, checkpointTree, git, checkpointWorkdir } =
  await import(bust("checkpoints.mjs"));

const { createRunnerManager } = await import(bust("runners.mjs"));

export async function init(state) {
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

  const runners = createRunnerManager(state);
  const {
    srvId, runnerInfo, listRunnerInfo, runnersChanged,
    spawnRunner, startRunner, stopRunner, sendToRunner,
    runnerFromReq, openSessionRunner, startPi, stopPi,
  } = runners;

  // ---------------------------------------------------------------- request context

  const requestContext = createRequestContext(state);
  const {
    json, readJsonBody,
    clientIp, checkAuth,
  } = requestContext;

  /** validate a session file reference. Accepts either:
   *  - absolute legacy path under SESSIONS_ROOT
   *  - root-relative path like "--workspace--/2026-...jsonl" (preferred)
   *  null if invalid/missing. */
  function sessionFileParam(raw) {
    const value = String(raw ?? "").trim();
    if (!value || !value.endsWith(".jsonl")) return null;
    const target = value.startsWith("/") ? resolve(value) : resolve(SESSIONS_ROOT, value);
    if (!target.startsWith(SESSIONS_ROOT + "/") || !existsSync(target)) return null;
    return target;
  }

  /** Back-compat: resolve a basename-only ?file=... by scanning session folders. */
  function sessionFileNameParam(raw) {
    const file = String(raw ?? "").trim();
    if (!file || file !== basename(file) || !file.endsWith(".jsonl")) return null;
    try {
      for (const folder of readdirSync(SESSIONS_ROOT)) {
        const dir = join(SESSIONS_ROOT, folder);
        try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
        const target = join(dir, file);
        if (existsSync(target)) return target;
      }
    } catch {}
    return null;
  }

  function sessionFileFromSearch(url) {
    return sessionFileParam(url.searchParams.get("path")) || sessionFileNameParam(url.searchParams.get("file"));
  }

  // ---------------------------------------------------------------- http helpers


  // ---------------------------------------------------------------- misc app logic

  /** Forked sessions are born with the placeholder name "⏪ <hash>"; the
   *  first prompt sent to one replaces it with a short title based on that
   *  message, so forks read like what they went on to do. */
  function autoTitleFork(runner, cmd) {
    if (cmd.type !== "prompt" || typeof cmd.message !== "string") return;
    if (!/^\u23EA [0-9a-f]{4,12}$/.test(runner.sessionName ?? "")) return;
    const title = cmd.message.replace(/\s+/g, " ").trim();
    if (!title) return;
    const short = title.length > 42 ? title.slice(0, 41).trimEnd() + "\u2026" : title;
    sendToRunner(runner, { id: srvId(), type: "set_session_name", name: `\u23EA ${short}` }, { autostart: false });
    runner.sessionName = `\u23EA ${short}`; // optimistic until get_state confirms
    runnersChanged();
  }

  // ---------------------------------------------------------------- routes (no auth)

  const openRoutes = createOpenRoutes({ state, listRunnerInfo, requestContext });
  const staticRoutes = createStaticRoutes({ config, requestContext });
  const runnerRoutes = createRunnerRoutes({
    state, requestContext, runnerFromReq, startRunner, listRunnerInfo,
    sendToRunner, stopRunner, runnerInfo, openSessionRunner,
    sessionFileParam, autoTitleFork,
  });
  const fileRoutes = createFileRoutes({ state, requestContext });
  const workdirRoutes = createWorkdirRoutes({ state, requestContext, spawnRunner, runnerInfo });
  const tunnelRoutes = createTunnelRoutes({
    state, config, requestContext, listTunnels, openTunnel, closeTunnel,
    spawnHublotAgent,
  });
  const checkpointRoutes = createCheckpointRoutes({
    state, config, requestContext, runnerFromReq, checkpointWorkdir,
    recordCheckpoint, loadCheckpoints, checkpointTree, sessionFileParam,
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
      root: SESSIONS_ROOT, sessionDirFor, summarizeSessionFile, listSessions,
      listSessionFolders, searchSessions, sessionEntries, sessionMessages, findSessionById,
      readSessionHeaderInfo, sessionFileParam, sessionFileFromSearch,
    },
    runners: { stopRunner, runnersChanged },
    resources: { closeTunnel, releaseSessionRoutines },
  });

  // ---------------------------------------------------------------- routes (auth required)

  const routes = {
    // -------------------------------------------------- tunnels / hublots


  };

  const routeTable = createRouteTable({ static: staticRoutes, open: openRoutes, runner: runnerRoutes, session: sessionRoutes, file: fileRoutes, workdir: workdirRoutes, tunnel: tunnelRoutes, routine: routineRoutes, checkpoint: checkpointRoutes, authenticated: routes });
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
