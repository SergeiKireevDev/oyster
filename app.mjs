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

import { timingSafeEqual } from "node:crypto";
import { createReadStream, readFileSync, existsSync, readdirSync, statSync, mkdirSync, unlinkSync, writeFileSync, appendFileSync, renameSync, realpathSync } from "node:fs";

const isHidden = (name) => name.startsWith(".");
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
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

  // ---------------------------------------------------------------- auth

  const tokenBuf = Buffer.from(config.TOKEN);

  function tokenMatches(provided) {
    if (!provided) return false;
    const buf = Buffer.from(String(provided).trim());
    return buf.length === tokenBuf.length && timingSafeEqual(buf, tokenBuf);
  }

  function parseCookies(req) {
    const out = {};
    for (const part of (req.headers.cookie ?? "").split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    }
    return out;
  }

  /** Collect every place a token might arrive. Proxies and tunnels differ in
   *  what they strip (Authorization is the usual casualty), so accept the token
   *  from the query string, several headers, or a cookie. */
  function authCandidates(req, url) {
    const bearer = req.headers["authorization"];
    return {
      query: url.searchParams.get("token"),
      bearer: bearer?.startsWith("Bearer ") ? bearer.slice(7) : bearer,
      xAuthToken: req.headers["x-auth-token"],
      xApiKey: req.headers["x-api-key"],
      cookie: parseCookies(req).pi_ui_token,
    };
  }

  /** best-effort client identity for rate limiting: the tunnel edge puts the
   *  real address in a header (everything arrives from localhost otherwise) */
  function clientIp(req) {
    return req.headers["cf-connecting-ip"]
      || String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim()
      || req.socket.remoteAddress || "?";
  }

  // brute-force guard: after too many bad tokens from one address, reject
  // outright for a while (state-owned so it survives hot reloads)
  const AUTH_FAIL_WINDOW_MS = 10 * 60 * 1000;
  const AUTH_FAIL_MAX = 20;

  function recentAuthFailures(ip) {
    const fails = (state.authFails ??= new Map());
    const now = Date.now();
    const recent = (fails.get(ip) ?? []).filter((t) => now - t < AUTH_FAIL_WINDOW_MS);
    if (recent.length) fails.set(ip, recent); else fails.delete(ip);
    return recent;
  }

  function recordAuthFailure(ip) {
    recentAuthFailures(ip).push(Date.now());
  }

  /** @returns {"ok" | "fail" | "throttled"} */
  function checkAuth(req, url) {
    const ip = clientIp(req);
    if (recentAuthFailures(ip).length >= AUTH_FAIL_MAX) return "throttled";
    const candidates = authCandidates(req, url);
    // tokens in query strings leak into proxy logs, browser history and
    // Referer headers: only GETs may use one (EventSource can't send headers,
    // download links can't either) — mutating requests need a header or cookie
    if (req.method !== "GET") candidates.query = null;
    if (Object.values(candidates).some(tokenMatches)) {
      state.authFails?.delete(ip);
      return "ok";
    }
    recordAuthFailure(ip);
    // diagnostic: show which credentials arrived (masked) so stripped headers are visible
    const seen = Object.entries(candidates)
      .map(([k, v]) => `${k}=${v ? `${String(v).slice(0, 4)}…(${String(v).length})` : "-"}`)
      .join(" ");
    console.log(`[auth-fail] ${req.method} ${url.pathname} from ${ip} | ${seen} | ua=${req.headers["user-agent"] ?? "-"}`);
    return "fail";
  }

  // ---------------------------------------------------------------- path confinement
  //
  // The file explorer endpoints operate on arbitrary paths behind a single
  // bearer token. Confine them to a small set of roots and deny credential
  // stores, so a leaked token doesn't expose the whole account.

  const FS_ROOTS = [...new Set([homedir(), "/tmp", config.PI_DIR].map((p) => resolve(p)))];
  const FS_DENIED = [
    ...[".ssh", ".gnupg", ".aws", ".netrc", ".git-credentials", ".config/gh"].map((n) => join(homedir(), n)),
    join(config.DIRNAME, ".ui-token"),
  ];

  const within = (p, root) => p === root || p.startsWith(root + "/");

  /** Resolve symlinks and enforce the allowlist/denylist. Returns the real
   *  path, or null if it is out of bounds. */
  function confinePath(p) {
    let real = p;
    try {
      real = realpathSync(p);
    } catch {
      // target may not exist yet (file-save, upload): resolve its parent
      try { real = join(realpathSync(dirname(p)), basename(p)); } catch {}
    }
    if (!FS_ROOTS.some((r) => within(real, r))) return null;
    if (FS_DENIED.some((d) => within(real, d))) return null;
    return real;
  }

  function forbidden(res, p) {
    json(res, 403, { error: `path outside the allowed roots: ${p}` });
  }

  /** validate a ?path=/body path that must be a session .jsonl; null if not */
  function sessionFileParam(raw) {
    const target = resolve(String(raw ?? ""));
    if (!target.startsWith(SESSIONS_ROOT + "/") || !target.endsWith(".jsonl") || !existsSync(target)) return null;
    return target;
  }

  // ---------------------------------------------------------------- http helpers

  const PUBLIC_DIR = join(config.DIRNAME, "public");
  const DIST_DIR = join(config.DIRNAME, "dist");
  const SERVE_DIR = existsSync(join(DIST_DIR, "index.html")) ? DIST_DIR : PUBLIC_DIR;
  const INDEX_PATH = join(SERVE_DIR, "index.html");
  const STATIC_TYPES = new Map([
    [".js", "text/javascript; charset=utf-8"],
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".svg", "image/svg+xml"],
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
    [".ico", "image/x-icon"],
  ]);

  function readBody(req, limit = 5 * 1024 * 1024) {
    return new Promise((resolvePromise, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > limit) {
          reject(new Error("body too large"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  // binary-safe variant for file uploads
  function readRawBody(req, limit = 100 * 1024 * 1024) {
    return new Promise((resolvePromise, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > limit) {
          reject(new Error("body too large"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolvePromise(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  function json(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
  }

  async function readJsonBody(req, res) {
    try {
      return JSON.parse(await readBody(req));
    } catch (e) {
      json(res, 400, { error: `invalid JSON: ${e.message}` });
      return undefined;
    }
  }

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

  const openRoutes = {
    "GET /health": (req, res) => {
      json(res, 200, {
        ok: true,
        runners: listRunnerInfo(),
        clients: state.sseClients.size,
        reloadCount: state.reloadCount,
      });
    },

    // debug: shows which auth credentials reached the server (and whether each
    // validates) without requiring auth — helps diagnose header-stripping proxies
    "GET /authcheck": (req, res, url) => {
      const ip = clientIp(req);
      if (recentAuthFailures(ip).length >= AUTH_FAIL_MAX) {
        json(res, 429, { error: "too many auth failures — try again later" });
        return;
      }
      const candidates = authCandidates(req, url);
      const report = {};
      for (const [k, v] of Object.entries(candidates)) {
        report[k] = v ? (tokenMatches(v) ? "valid" : `present-invalid(len=${String(v).length})`) : "absent";
      }
      const authorized = Object.values(candidates).some(tokenMatches);
      // this endpoint is a validity oracle: count failed probes against the
      // same budget as regular auth failures
      if (!authorized && Object.values(candidates).some(Boolean)) recordAuthFailure(ip);
      json(res, 200, { authorized, credentials: report });
    },
  };

  // ---------------------------------------------------------------- routes (auth required)

  const routes = {
    // -------------------------------------------------- runner I/O

    "GET /events": (req, res, url) => {
      const runner = runnerFromReq(url);
      if (!runner.proc) startRunner(runner);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(`: connected\n\n`);
      res.runnerId = runner.id; // this client sees only this runner's stream
      // Register the client BEFORE replaying buffered events. Browser
      // EventSource may fire `open` as soon as headers/first bytes arrive, and
      // the UI immediately sends get_state/get_messages RPCs. If this response
      // is still replaying and not yet in state.sseClients, those RPC responses
      // can be broadcast to nobody and the client times out waiting for them.
      state.sseClients.add(res);
      let ping = null;
      req.on("close", () => {
        if (ping) clearInterval(ping);
        state.sseClients.delete(res);
      });
      // replay this runner's buffered events so the client can reconstruct
      // in-flight state
      if (url.searchParams.get("replay") !== "0") {
        for (const line of runner.buffer) res.write(`data: ${line}\n\n`);
      }
      res.write(`data: ${JSON.stringify({
        type: "replay_done", _server: true,
        runner: runner.id, piRunning: !!runner.proc, workdir: runner.dir,
        runners: listRunnerInfo(),
      })}\n\n`);
      // data pings (not SSE comments) so the client can detect a dead
      // connection: comments never reach onmessage, real events do. They
      // carry the runner list so a client that missed a pi_exit/pi_started
      // (buffer overflow, reconnect gap) still converges on real liveness.
      ping = setInterval(
        () => res.write(`data: ${JSON.stringify({ type: "ping", _server: true, runners: listRunnerInfo() })}\n\n`),
        25000
      );
    },

    "POST /rpc": async (req, res, url) => {
      const cmd = await readJsonBody(req, res);
      if (cmd === undefined) return;
      if (!cmd || typeof cmd !== "object" || typeof cmd.type !== "string") {
        json(res, 400, { error: "command must be an object with a string `type`" });
        return;
      }
      const runner = runnerFromReq(url);
      const ok = sendToRunner(runner, cmd);
      if (ok) autoTitleFork(runner, cmd);
      // pendingResume: the command was accepted but is held back until an
      // in-flight session resume completes — tell the client so "queued"
      // silence doesn't look like an unresponsive session
      json(res, ok ? 202 : 503, ok
        ? { queued: true, runner: runner.id, ...(runner.resumeId ? { pendingResume: true } : {}) }
        : { error: "pi process unavailable" });
    },

    "GET /runners": (req, res) => {
      json(res, 200, { runners: listRunnerInfo() });
    },

    "DELETE /runners": (req, res, url) => {
      const runner = state.runners.get(String(url.searchParams.get("id") ?? ""));
      if (!runner) { json(res, 404, { error: "no such runner" }); return; }
      // stop the process but KEEP the runner entry: it remembers its
      // session, so the next rpc/prompt to it respawns pi and resumes
      stopRunner(runner);
      json(res, 200, { stopped: runner.id });
    },

    "POST /restart": (req, res, url) => {
      const runner = runnerFromReq(url);
      stopRunner(runner);
      setTimeout(() => { if (state.runners.has(runner.id)) startRunner(runner); }, 300);
      json(res, 202, { restarting: true, runner: runner.id });
    },

    // -------------------------------------------------- sessions

    // get-or-spawn a runner for a session (or a fresh session in a folder)
    "POST /open-session": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      let sessionPath = body?.sessionPath ? sessionFileParam(body.sessionPath) : null;
      if (body?.sessionPath && !sessionPath) {
        json(res, 400, { error: `not a session file: ${body.sessionPath}` });
        return;
      }
      let dir = body?.dir ? confinePath(resolve(String(body.dir))) : null;
      if (body?.dir && !dir) { forbidden(res, body.dir); return; }
      if (dir) {
        let ok = false;
        try { ok = statSync(dir).isDirectory(); } catch {}
        if (!ok) { json(res, 400, { error: `not a directory: ${dir}` }); return; }
        state.currentDir = dir; // keep /sessions and /browse in this folder
      }
      const runner = openSessionRunner({ sessionPath, dir });
      json(res, 200, { runner: runnerInfo(runner) });
    },

    "GET /sessions": (req, res, url) => {
      // ?path= lists another sessions folder (must live under the sessions root);
      // ?dir= lists the sessions of a working directory (e.g. the current session's)
      let dir;
      if (url.searchParams.get("path")) {
        dir = resolve(String(url.searchParams.get("path")));
        if (!dir.startsWith(SESSIONS_ROOT)) {
          json(res, 400, { error: "folder must be under the sessions root" });
          return;
        }
      } else if (url.searchParams.get("dir")) {
        dir = sessionDirFor(resolve(String(url.searchParams.get("dir"))));
      }
      // annotate each session with its live runner (if any) so the picker
      // can show running/busy indicators
      const live = [...state.runners.values()];
      const sessions = listSessions(dir ?? sessionDirFor(state.currentDir)).map((s) => {
        const r = live.find((x) => x.sessionFile === s.path);
        return { ...s, runnerId: r?.id ?? null, alive: !!r?.proc, busy: !!r?.busy };
      });
      json(res, 200, { sessions });
    },

    "DELETE /session": (req, res, url) => {
      const target = sessionFileParam(url.searchParams.get("path"));
      if (!target) {
        json(res, 400, { error: `not a session file: ${url.searchParams.get("path")}` });
        return;
      }
      try {
        // also retire any runner still attached to this session
        for (const r of [...state.runners.values()]) {
          if (r.sessionFile === target) {
            stopRunner(r);
            state.runners.delete(r.id);
            if (state.defaultRunnerId === r.id) state.defaultRunnerId = null;
          }
        }
        runnersChanged();
        // close any hublots bound to this session (kills service,
        // background agent and cloudflared — see closeTunnel)
        let sessionId = null;
        try { sessionId = readSessionHeaderInfo(target)?.id ?? null; } catch {}
        const closedHublots = [];
        if (sessionId) {
          for (const t of [...(state.tunnels?.values() ?? [])]) {
            if (t.sessionId === sessionId) {
              closeTunnel(state, t.id);
              closedHublots.push(t.port);
              console.log(`[pi-ui] closed hublot :${t.port} (session ${sessionId} deleted)`);
            }
          }
        }
        // release (and stop) any routines bound to this session
        const releasedRoutines = sessionId ? releaseSessionRoutines(state, sessionId) : [];
        unlinkSync(target);
        json(res, 200, { deleted: target, closedHublots, releasedRoutines });
      } catch (e) {
        json(res, 500, { error: `failed to delete session: ${e.message}` });
      }
    },


    "GET /session-by-id": (req, res, url) => {
      const id = String(url.searchParams.get("id") ?? "").trim();
      if (!id) { json(res, 400, { error: "id required" }); return; }
      const path = findSessionById(id);
      if (!path) { json(res, 404, { error: `no session with id ${id}` }); return; }
      try {
        json(res, 200, { session: { path, ...summarizeSessionFile(path) } });
      } catch (e) {
        json(res, 500, { error: `failed to read session: ${e.message}` });
      }
    },

    "GET /session-entries": (req, res, url) => {
      const target = sessionFileParam(url.searchParams.get("path"));
      if (!target) {
        json(res, 400, { error: `not a session file: ${url.searchParams.get("path")}` });
        return;
      }
      try {
        json(res, 200, sessionEntries(target));
      } catch (e) {
        json(res, 500, { error: `failed to parse session: ${e.message}` });
      }
    },

    "GET /session-messages": (req, res, url) => {
      const target = sessionFileParam(url.searchParams.get("path"));
      if (!target) {
        json(res, 400, { error: `not a session file: ${url.searchParams.get("path")}` });
        return;
      }
      try {
        json(res, 200, sessionMessages(target));
      } catch (e) {
        json(res, 500, { error: `failed to parse session: ${e.message}` });
      }
    },

    "GET /session-folders": (req, res, url) => {
      // ?dir= reports "current" relative to that working directory
      const forDir = url.searchParams.get("dir") ? resolve(String(url.searchParams.get("dir"))) : state.currentDir;
      json(res, 200, { folders: listSessionFolders(), current: sessionDirFor(forDir) });
    },

    "GET /search": (req, res, url) => {
      const q = String(url.searchParams.get("q") ?? "").trim();
      const scope = String(url.searchParams.get("scope") ?? "folder");
      const path = url.searchParams.get("path") ? resolve(String(url.searchParams.get("path"))) : null;
      if (q.length < 2) {
        json(res, 400, { error: "query must be at least 2 characters" });
        return;
      }
      if (!["session", "folder", "all"].includes(scope)) {
        json(res, 400, { error: `invalid scope: ${scope}` });
        return;
      }
      if (scope === "session" && (!path || !path.startsWith(SESSIONS_ROOT + "/") || !path.endsWith(".jsonl"))) {
        json(res, 400, { error: "scope=session requires a session file path" });
        return;
      }
      if (scope === "folder" && path && !path.startsWith(SESSIONS_ROOT)) {
        json(res, 400, { error: "folder must be under the sessions root" });
        return;
      }
      const includeTools = url.searchParams.get("tools") === "1";
      try {
        json(res, 200, { q, scope, ...searchSessions({ q, scope, path, includeTools, defaultDir: sessionDirFor(state.currentDir) }) });
      } catch (e) {
        json(res, 500, { error: `search failed: ${e.message}` });
      }
    },

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

  // ---------------------------------------------------------------- dispatch

  // permalink routes are client-side: /s/<sessionId> and /s/<sessionId>/m/<entryId>
  // both serve the UI; the client parses the path and opens the session
  function isAppRoute(pathname) {
    return pathname === "/" || pathname === "/index.html" ||
      /^\/s\/[\w.-]+(\/m\/[\w.-]+)?$/.test(pathname);
  }

  function serveApp(res) {
    if (!existsSync(INDEX_PATH)) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("public/index.html missing");
      return;
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
    });
    res.end(readFileSync(INDEX_PATH));
  }

  function servePublicAsset(pathname, res) {
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return false; }
    const rel = decoded.replace(/^\/+/, "");
    const target = resolve(SERVE_DIR, rel);
    if (!within(target, SERVE_DIR) || !existsSync(target) || statSync(target).isDirectory()) return false;
    res.writeHead(200, {
      "content-type": STATIC_TYPES.get(extname(target).toLowerCase()) ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    createReadStream(target).pipe(res);
    return true;
  }

  async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const key = `${req.method} ${url.pathname}`;

    if (req.method === "GET" && isAppRoute(url.pathname)) return serveApp(res);
    if (req.method === "GET" && servePublicAsset(url.pathname, res)) return;

    const open = openRoutes[key];
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

    const route = routes[key];
    if (route) return route(req, res, url);

    // same path exists under another method -> 405, otherwise 404
    const pathKnown = [...Object.keys(routes), ...Object.keys(openRoutes)]
      .some((k) => k.endsWith(` ${url.pathname}`));
    json(res, pathKnown ? 405 : 404, { error: pathKnown ? "method not allowed" : "not found" });
  }

  return {
    handleRequest, startPi, stopPi,
    stopTunnels: () => closeAllTunnels(state),
    stopRoutines: () => stopAllRoutines(state),
  };
}
