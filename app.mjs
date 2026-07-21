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

import { createReadStream, readFileSync, existsSync, readdirSync, statSync, mkdirSync, unlinkSync, writeFileSync, appendFileSync, renameSync } from "node:fs";

const isHidden = (name) => name.startsWith(".");
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequestContext } from "./http/createRequestContext.mjs";
import { createRouteTable } from "./http/createRouteTable.mjs";
import { createOpenRoutes } from "./http/routes/openRoutes.mjs";
import { createStaticRoutes } from "./http/routes/staticRoutes.mjs";
import { createRunnerRoutes } from "./http/routes/runnerRoutes.mjs";
import { createSessionRoutes } from "./http/routes/sessionRoutes.mjs";

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

export function init(state) {
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
    json, readRawBody, readJsonBody,
    clientIp, checkAuth, resolveSafePath: confinePath,
  } = requestContext;

  function forbidden(res, p) {
    json(res, 403, { error: `path outside the allowed roots: ${p}` });
  }

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
    // -------------------------------------------------- file explorer (confined)

    "GET /browse": (req, res, url) => {
      const target = confinePath(resolve(url.searchParams.get("path") || state.currentDir));
      if (!target) { forbidden(res, url.searchParams.get("path")); return; }
      let entries;
      try {
        entries = readdirSync(target, { withFileTypes: true });
      } catch (e) {
        json(res, 400, { error: `cannot read ${target}: ${e.message}` });
        return;
      }
      const dirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => ({ name: e.name, hidden: isHidden(e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      // files are only needed by the attach-file picker (?files=1)
      let files;
      if (url.searchParams.get("files") === "1") {
        files = entries
          .filter((e) => e.isFile())
          .map((e) => {
            let size = null;
            try { size = statSync(join(target, e.name)).size; } catch {}
            return { name: e.name, size, hidden: isHidden(e.name) };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
      }
      json(res, 200, {
        path: target,
        parent: dirname(target) === target ? null : dirname(target),
        dirs,
        ...(files ? { files } : {}),
        home: homedir(),
        workdir: state.currentDir,
      });
    },

    "GET /file-download": (req, res, url) => {
      const target = confinePath(resolve(String(url.searchParams.get("path") ?? "")));
      if (!target) { forbidden(res, url.searchParams.get("path")); return; }
      let st;
      try { st = statSync(target); } catch (e) { json(res, 404, { error: e.message }); return; }
      if (!st.isFile()) { json(res, 400, { error: "not a file" }); return; }
      // header-safe filename: strip control chars (CR/LF would smuggle
      // headers) and non-ASCII, neutralize quotes/backslashes
      const safeName = basename(target).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "'") || "download";
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": st.size,
        "content-disposition": `attachment; filename="${safeName}"`,
      });
      createReadStream(target).pipe(res);
    },

    "GET /file-content": (req, res, url) => {
      const target = confinePath(resolve(String(url.searchParams.get("path") ?? "")));
      if (!target) { forbidden(res, url.searchParams.get("path")); return; }
      let st;
      try { st = statSync(target); } catch (e) { json(res, 404, { error: e.message }); return; }
      if (!st.isFile()) { json(res, 400, { error: "not a file" }); return; }
      if (st.size > 2 * 1024 * 1024) { json(res, 413, { error: `file too large to edit in browser (${st.size} bytes)` }); return; }
      const buf = readFileSync(target);
      if (buf.includes(0)) { json(res, 415, { error: "binary file — download it instead" }); return; }
      json(res, 200, { path: target, content: buf.toString("utf8") });
    },

    "POST /file-save": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const target = confinePath(resolve(String(body?.path ?? "")));
      if (!target) { forbidden(res, body?.path); return; }
      if (typeof body?.content !== "string") { json(res, 400, { error: "content must be a string" }); return; }
      let dirOk = false;
      try { dirOk = statSync(dirname(target)).isDirectory(); } catch {}
      if (!dirOk) { json(res, 400, { error: `no such directory: ${dirname(target)}` }); return; }
      try {
        writeFileSync(target, body.content, "utf8");
      } catch (e) {
        json(res, 500, { error: `save failed: ${e.message}` });
        return;
      }
      console.log(`[pi-ui] file saved via explorer: ${target}`);
      json(res, 200, { saved: target, bytes: Buffer.byteLength(body.content) });
    },

    "POST /file-upload": async (req, res, url) => {
      // chunked raw body upload:
      //   ?dir=<target folder>&name=<file name>&offset=<byte offset>&last=<0|1>
      // chunks must arrive in order; offset=0 starts a fresh upload, last=1 finalizes.
      // single-shot uploads (no offset/last params) behave as before.
      const dir = confinePath(resolve(String(url.searchParams.get("dir") ?? "")));
      if (!dir) { forbidden(res, url.searchParams.get("dir")); return; }
      const name = String(url.searchParams.get("name") ?? "").trim();
      if (!name || name === "." || name === ".." || /[/\\]/.test(name)) {
        json(res, 400, { error: "invalid file name" });
        return;
      }
      let dirOk = false;
      try { dirOk = statSync(dir).isDirectory(); } catch {}
      if (!dirOk) { json(res, 400, { error: `not a directory: ${dir}` }); return; }
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const last = url.searchParams.get("last") !== "0"; // default: single-shot = final
      if (!Number.isInteger(offset) || offset < 0) {
        json(res, 400, { error: "invalid offset" });
        return;
      }
      let buf;
      try { buf = await readRawBody(req); } catch (e) { json(res, 413, { error: e.message }); return; }
      const target = join(dir, name);
      const tmp = join(dir, `.${name}.upload`);
      try {
        if (offset === 0) {
          writeFileSync(tmp, buf); // start fresh (truncates any stale partial)
        } else {
          let cur = -1;
          try { cur = statSync(tmp).size; } catch {}
          if (cur === -1 && last) {
            // retried final chunk whose first attempt already renamed the temp file
            let doneSize = -1;
            try { doneSize = statSync(target).size; } catch {}
            if (doneSize === offset + buf.length) {
              json(res, 200, { saved: target, bytes: doneSize });
              return;
            }
          }
          if (cur >= offset + buf.length) {
            // retried chunk that was already applied (response was lost) — idempotent ok
            if (!last) { json(res, 200, { received: cur }); return; }
            // last chunk already appended but not yet renamed: fall through to rename
          } else if (cur !== offset) {
            json(res, 409, { error: `chunk out of sequence: have ${cur} bytes, got offset ${offset}`, have: Math.max(cur, 0) });
            return;
          } else {
            appendFileSync(tmp, buf);
          }
        }
        if (last) renameSync(tmp, target);
      } catch (e) {
        try { unlinkSync(tmp); } catch {}
        json(res, 500, { error: `upload failed: ${e.message}` });
        return;
      }
      if (last) {
        const bytes = statSync(target).size;
        console.log(`[pi-ui] file uploaded via explorer: ${target} (${bytes} bytes)`);
        json(res, 200, { saved: target, bytes });
      } else {
        json(res, 200, { received: offset + buf.length });
      }
    },

    "POST /mkdir": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const parent = confinePath(resolve(String(body?.path ?? "")));
      if (!parent) { forbidden(res, body?.path); return; }
      const name = String(body?.name ?? "").trim();
      if (!name || name === "." || name === ".." || /[/\\]/.test(name)) {
        json(res, 400, { error: "invalid folder name" });
        return;
      }
      let parentOk = false;
      try { parentOk = statSync(parent).isDirectory(); } catch {}
      if (!parentOk) {
        json(res, 400, { error: `not a directory: ${parent}` });
        return;
      }
      const target = join(parent, name);
      if (existsSync(target)) {
        json(res, 409, { error: `already exists: ${target}` });
        return;
      }
      try {
        mkdirSync(target);
      } catch (e) {
        json(res, 500, { error: `mkdir failed: ${e.message}` });
        return;
      }
      console.log(`[pi-ui] created folder ${target}`);
      json(res, 201, { path: target });
    },

    "POST /workdir": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const target = confinePath(resolve(String(body?.path ?? "")));
      if (!target) { forbidden(res, body?.path); return; }
      let ok = false;
      try { ok = statSync(target).isDirectory(); } catch {}
      if (!ok) {
        json(res, 400, { error: `not a directory: ${target}` });
        return;
      }
      state.currentDir = target;
      console.log(`[pi-ui] workdir changed to ${state.currentDir}, spawning a runner there`);
      const runner = spawnRunner({ dir: target });
      json(res, 200, { workdir: state.currentDir, runner: runnerInfo(runner) });
    },

    // -------------------------------------------------- tunnels / hublots

    "GET /tunnels": (req, res) => {
      json(res, 200, { tunnels: listTunnels(state), bin: config.TUNNEL_BIN });
    },

    "POST /tunnels": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      // no port given: allocate the next free one, starting at 3000
      let port = body?.port;
      if (!port) {
        if (!state.nextHublotPort) state.nextHublotPort = 3000;
        const used = new Set([...(state.tunnels?.values() ?? [])].map((t) => t.port));
        while (used.has(state.nextHublotPort)) state.nextHublotPort++;
        port = state.nextHublotPort++;
      }
      const brief = body?.brief ? String(body.brief) : null;
      try {
        const tunnel = await openTunnel(state, {
          port,
          label: body?.label ? String(body.label).slice(0, 200) : null,
          sessionId: body?.sessionId ? String(body.sessionId).slice(0, 100) : null,
        });
        if (brief) {
          const live = state.tunnels.get(tunnel.id);
          spawnHublotAgent(state, live ?? tunnel, brief);
        }
        json(res, 201, { tunnel, agent: !!brief });
      } catch (e) {
        json(res, 502, { error: e.message });
      }
    },

    "PATCH /tunnels": async (req, res) => {
      // rebind a hublot to another session (e.g. opened by a one-shot
      // agent on behalf of a UI session)
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const t = state.tunnels.get(String(body?.id ?? ""));
      if (!t) {
        json(res, 404, { error: "no such hublot" });
        return;
      }
      t.sessionId = body?.sessionId ? String(body.sessionId).slice(0, 100) : null;
      state.serverEvent({ type: "tunnel_opened", tunnel: listTunnels(state).find((x) => x.id === t.id) });
      json(res, 200, { tunnel: listTunnels(state).find((x) => x.id === t.id) });
    },

    "DELETE /tunnels": (req, res, url) => {
      const closed = closeTunnel(state, String(url.searchParams.get("id") ?? ""));
      if (!closed) {
        json(res, 404, { error: "no such tunnel" });
        return;
      }
      json(res, 200, { closed });
    },

    // -------------------------------------------------- routines

    "GET /routines": (req, res) => {
      json(res, 200, { routines: listRoutines(state), dir: routinesDir() });
    },

    "POST /routines": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const name = String(body?.name ?? "").trim();
      const action = String(body?.action ?? "");
      const sessionId = body?.sessionId ? String(body.sessionId).slice(0, 100) : null;
      if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".")) {
        json(res, 400, { error: `invalid routine name: ${name}` });
        return;
      }
      // create/start bind the routine to the calling session and run it in
      // that session's workdir (so byproducts land in the right project)
      const sessionCwd = () => {
        const runner = sessionId
          ? [...state.runners.values()].find((r) => r.sessionId === sessionId)
          : null;
        return runner?.dir ?? state.currentDir;
      };
      try {
        if (action === "create") {
          const script = typeof body?.script === "string" ? body.script : null;
          if (!script || script.length > 256 * 1024) {
            json(res, 400, { error: "create requires a `script` string (max 256KB)" });
            return;
          }
          json(res, 201, { routine: createRoutine(state, { name, script, sessionId, cwd: sessionCwd() }) });
        }
        else if (action === "start") json(res, 200, { routine: startRoutine(state, name, { sessionId, cwd: sessionCwd() }) });
        else if (action === "stop") json(res, 200, { routine: stopRoutine(state, name) });
        else if (action === "teardown") json(res, 200, { routine: teardownRoutine(state, name) });
        else if (action === "release") json(res, 200, { routine: releaseRoutine(state, name) });
        else if (action === "delete") json(res, 200, { routine: deleteRoutine(state, name) });
        else json(res, 400, { error: `unknown action: ${action}` });
      } catch (e) {
        json(res, 400, { error: e.message });
      }
    },

    // -------------------------------------------------- checkpoints / rollback

    "POST /checkpoint": async (req, res, url) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const runner = runnerFromReq(url);
      const label = body?.label ? String(body.label).slice(0, 200) : null;
      const model = body?.model ? String(body.model).slice(0, 200) : null;
      const { status, body: out } = await checkpointWorkdir(config.PI_BIN, runner.dir, label, model);
      // anchor the checkpoint to the session's latest message (also when the
      // tree was already clean: HEAD marks that state just as well)
      if (status === 200 && out.hash && runner.sessionFile && existsSync(runner.sessionFile)) {
        try {
          const rec = recordCheckpoint(runner.sessionFile, runner.dir, out);
          if (rec) { out.recorded = true; out.anchorId = rec.anchorId; }
        } catch (e) {
          console.error(`[pi-ui] failed to record checkpoint: ${e.message}`);
        }
      }
      json(res, status, out);
    },

    "GET /checkpoints": (req, res, url) => {
      const id = String(url.searchParams.get("id") ?? "").trim();
      if (!id) { json(res, 400, { error: "id required" }); return; }
      json(res, 200, { checkpoints: loadCheckpoints()[id] ?? [] });
    },

    "GET /checkpoint-tree": (req, res, url) => {
      const target = sessionFileParam(url.searchParams.get("path"));
      if (!target) {
        json(res, 400, { error: `not a session file: ${url.searchParams.get("path")}` });
        return;
      }
      try {
        json(res, 200, checkpointTree(target));
      } catch (e) {
        json(res, 500, { error: `tree failed: ${e.message}` });
      }
    },

    "POST /rollback": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const sessionId = String(body?.sessionId ?? "").trim();
      const hash = String(body?.hash ?? "").trim();
      const model = body?.model ? String(body.model).slice(0, 200) : null;
      const cp = (loadCheckpoints()[sessionId] ?? []).find((c) => c.hash === hash);
      if (!cp) { json(res, 404, { error: "no such checkpoint" }); return; }
      if (!existsSync(cp.sessionPath)) { json(res, 410, { error: "session file of this checkpoint is gone" }); return; }
      try {
        // 1. nothing may be lost: auto-commit pending changes and record them
        //    as a checkpoint at the session's current tip (→ roll forward later)
        let safety = null;
        const st = await git(cp.dir, ["status", "--porcelain"]);
        if (st.code === 0 && st.stdout.trim()) {
          const saved = await checkpointWorkdir(config.PI_BIN, cp.dir, `auto before rollback to ${hash}`, model);
          if (saved.body.committed) {
            safety = saved.body.hash;
            try { recordCheckpoint(cp.sessionPath, cp.dir, saved.body); } catch {}
          }
        }
        // 2. deterministic restore of the checkpointed state
        const rs = await git(cp.dir, ["reset", "--hard", hash]);
        if (rs.code !== 0) {
          json(res, 500, { error: `git reset failed: ${(rs.stderr || rs.stdout).trim()}` });
          return;
        }
        // 3. fork the session at the checkpointed entry — no LLM involved
        const fork = forkSessionAt(cp.sessionPath, cp.leafId ?? cp.anchorId, hash);
        // the fork keeps its ancestors' entry ids: inherit their checkpoints
        const db = loadCheckpoints();
        db[fork.id] = (db[sessionId] ?? [])
          .filter((c) => fork.entryIds.has(c.anchorId))
          .map((c) => ({ ...c, sessionPath: fork.path }));
        saveCheckpoints(db);
        // 4. attach a runner to the fork and hand it to the client
        const runner = openSessionRunner({ sessionPath: fork.path, dir: cp.dir });
        sendToRunner(runner, { id: srvId(), type: "set_session_name", name: `\u23EA ${hash}` });
        runner.sessionName = `\u23EA ${hash}`; // optimistic — lets the first prompt auto-title the fork right away
        console.log(`[pi-ui] rolled back ${cp.dir} to ${hash}, forked session ${fork.id}`);
        json(res, 200, { rolledBack: hash, safety, fork: { id: fork.id, path: fork.path }, runner: runnerInfo(runner) });
      } catch (e) {
        json(res, 500, { error: `rollback failed: ${e.message}` });
      }
    },
  };

  const routeTable = createRouteTable({ static: staticRoutes, open: openRoutes, runner: runnerRoutes, session: sessionRoutes, authenticated: routes });
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
