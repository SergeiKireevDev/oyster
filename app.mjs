/**
 * pi-lot-ui — hot-reloadable application logic
 *
 * Loaded by server.mjs (the stable core) via dynamic import. Everything here
 * can be edited while the server runs; the core re-imports this module on
 * change and swaps the handler atomically. All state that must survive a
 * reload (pi process, SSE clients, event buffer, config) lives in the `state`
 * object owned by the core — this module only reads/writes it.
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
 *   GET  /session-tree -> entries of one session as tree nodes (id/parentId)
 *   GET  /session-by-id -> locate a session file from its session id (?id=…)
 *   GET  /session-entries -> ordered user/assistant entries of the active
 *                          branch of one session (?path=…) — permalink anchors
 *   GET  /session-folders -> all folders under ~/.pi/agent/sessions
 *   GET  /search      -> full-text search (?q=…&scope=session|folder|all[&path=…])
 *   GET  /browse      -> list subdirectories for the folder picker
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
 *   POST /tunnels     -> open a tunnel { port, label?, sessionId? } (cloudflared quick tunnel)
 *   DELETE /tunnels   -> close a tunnel (?id=…)
 *   GET  /routines    -> runnable scripts in ~/.pi/routines/ (+ live state & session bindings)
 *   POST /routines    -> { name, action: "create" | "start" | "stop" | "teardown" | "release" | "delete",
 *                          sessionId?, script? (create only) }
 */

import { spawn, execFile } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createConnection } from "node:net";
import { createReadStream, readFileSync, existsSync, readdirSync, statSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// import tunnels.mjs with a cache-busting query so hot reloads of app.mjs
// pick up the current version instead of a stale cached module
const TUNNELS_PATH = join(dirname(fileURLToPath(import.meta.url)), "tunnels.mjs");
const { listTunnels, openTunnel, closeTunnel, closeAllTunnels, pidsOnPort } =
  await import(`./tunnels.mjs?v=${statSync(TUNNELS_PATH).mtimeMs}`);

const ROUTINES_PATH = join(dirname(fileURLToPath(import.meta.url)), "routines.mjs");
const { listRoutines, createRoutine, deleteRoutine, startRoutine, stopRoutine, teardownRoutine, releaseRoutine, releaseSessionRoutines, stopAllRoutines, routinesDir } =
  await import(`./routines.mjs?v=${statSync(ROUTINES_PATH).mtimeMs}`);

export function init(state) {
  const { config, broadcast, serverEvent } = state;

  // ---------------------------------------------------------------- pi runners
  //
  // One pi process per open session ("runner"). Runners keep working in the
  // background when the browser looks at another session; each SSE client
  // subscribes to exactly one runner, and runner status (busy/idle/dead) is
  // broadcast to everyone so session lists can show live indicators.

  const RUNNER_BUFFER_MAX = 400;

  if (!state.runners) state.runners = new Map(); // id -> runner
  if (!state.runnerSeq) state.runnerSeq = 0;

  function runnerInfo(r) {
    return {
      id: r.id, dir: r.dir, sessionFile: r.sessionFile, sessionId: r.sessionId,
      sessionName: r.sessionName, busy: r.busy, alive: !!r.proc,
    };
  }

  /** global (all-clients) notification that some runner changed state */
  function runnersChanged() {
    serverEvent({ type: "runners_update", runners: [...state.runners.values()].map(runnerInfo) });
  }

  /** deliver a line only to SSE clients subscribed to this runner */
  function runnerWrite(runner, line) {
    runner.buffer.push(line);
    if (runner.buffer.length > RUNNER_BUFFER_MAX) runner.buffer.shift();
    for (const res of state.sseClients) {
      if (res.runnerId === runner.id) res.write(`data: ${line}\n\n`);
    }
  }

  function runnerEvent(runner, obj) {
    runnerWrite(runner, JSON.stringify({ ...obj, _server: true, runner: runner.id }));
  }

  /** watch a runner's stdout to maintain busy/session metadata */
  function trackRunner(runner, line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type === "agent_start") { runner.busy = true; runnersChanged(); }
    else if (msg.type === "agent_end") { runner.busy = false; runnersChanged(); requestState(runner); }
    else if (msg.type === "response" && msg.id === runner.resumeId) {
      // session resume finished (success or not): deliver held-back commands
      finishResume(runner);
      if (msg.success) requestState(runner);
    }
    else if (msg.type === "response" && msg.success) {
      if (msg.command === "get_state" && msg.data) {
        const d = msg.data;
        const changed = runner.sessionFile !== d.sessionFile ||
          runner.sessionId !== d.sessionId || runner.sessionName !== d.sessionName;
        runner.sessionFile = d.sessionFile ?? runner.sessionFile;
        runner.sessionId = d.sessionId ?? runner.sessionId;
        runner.sessionName = d.sessionName ?? null;
        runner.busy = !!(d.isStreaming || d.isCompacting);
        if (changed) runnersChanged();
      } else if (["switch_session", "new_session", "set_session_name"].includes(msg.command)) {
        requestState(runner);
      }
    }
  }

  let srvSeq = 0;
  function requestState(runner) {
    sendToRunner(runner, { id: `_srv-${++srvSeq}`, type: "get_state" }, { autostart: false });
  }

  /** flush commands that were held back while a session resume was in flight */
  function finishResume(runner) {
    if (!runner.resumeId) return;
    runner.resumeId = null;
    clearTimeout(runner.resumeTimer);
    const queued = runner.resumeQueue ?? [];
    runner.resumeQueue = [];
    for (const obj of queued) {
      if (runner.proc?.stdin.writable) runner.proc.stdin.write(JSON.stringify(obj) + "\n");
    }
  }

  function spawnRunner({ dir, sessionPath = null }) {
    const runner = {
      id: `r${++state.runnerSeq}`,
      dir,
      sessionFile: sessionPath,
      sessionId: null,
      sessionName: null,
      busy: false,
      proc: null,
      buffer: [],
      startCount: 0,
      lastSpawnAt: 0,
    };
    state.runners.set(runner.id, runner);
    startRunner(runner);
    return runner;
  }

  function startRunner(runner) {
    if (runner.proc) return;
    const now = Date.now();
    // crash-loop guard: if this runner died within 2s of spawning, wait
    if (now - runner.lastSpawnAt < 2000 && runner.startCount > 0) {
      setTimeout(() => { if (!runner.proc && state.runners.has(runner.id)) startRunner(runner); }, 2000);
      return;
    }
    runner.lastSpawnAt = now;
    runner.startCount++;
    const args = ["--mode", "rpc", ...config.PI_EXTRA_ARGS];
    console.log(`[pi-ui] spawning runner ${runner.id}: ${config.PI_BIN} ${args.join(" ")} (cwd: ${runner.dir})`);
    const proc = spawn(config.PI_BIN, args, { cwd: runner.dir, stdio: ["pipe", "pipe", "pipe"] });
    runner.proc = proc;

    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      line = line.trim();
      if (!line) return;
      trackRunner(runner, line);
      runnerWrite(runner, line);
    });

    proc.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) console.error(`[pi ${runner.id} stderr] ${text}`);
    });

    proc.on("error", (err) => {
      console.error(`[pi-ui] failed to spawn runner ${runner.id}: ${err.message}`);
      runnerEvent(runner, { type: "pi_error", error: err.message });
      if (runner.proc === proc) runner.proc = null;
      runnersChanged();
    });

    proc.on("exit", (code, signal) => {
      console.log(`[pi-ui] runner ${runner.id} exited (code=${code}, signal=${signal})`);
      if (runner.proc === proc) {
        runner.proc = null;
        runner.busy = false;
        runnerEvent(runner, { type: "pi_exit", code, signal });
        runnersChanged();
      }
    });

    // resume the runner's session after a restart (fresh runners with a
    // requested sessionPath also land here). pi handles a prompt arriving
    // right behind switch_session concurrently, and the switch then discards
    // the run — so hold every other command back until the resume completes.
    if (runner.sessionFile) {
      runner.resumeId = `_srv-${++srvSeq}`;
      proc.stdin.write(JSON.stringify({ id: runner.resumeId, type: "switch_session", sessionPath: runner.sessionFile }) + "\n");
      // safety valve: never hold commands forever if the response goes missing
      clearTimeout(runner.resumeTimer);
      runner.resumeTimer = setTimeout(() => finishResume(runner), 15000);
      runner.resumeTimer.unref?.();
    } else {
      requestState(runner);
    }
    runnerEvent(runner, { type: "pi_started", startCount: runner.startCount });
    runnersChanged();
  }

  function stopRunner(runner) {
    const proc = runner.proc;
    if (!proc) return;
    runner.proc = null;
    runner.busy = false;
    proc.removeAllListeners("exit");
    proc.on("exit", () => runnerEvent(runner, { type: "pi_exit", code: null, signal: "SIGTERM" }));
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) proc.kill("SIGKILL");
    }, 3000).unref();
    runnersChanged();
  }

  function sendToRunner(runner, obj, { autostart = true } = {}) {
    if (!runner.proc && autostart) startRunner(runner);
    if (!runner.proc || !runner.proc.stdin.writable) return false;
    if (runner.resumeId) {
      // a session resume is in flight; deliver after it completes
      (runner.resumeQueue ??= []).push(obj);
      return true;
    }
    runner.proc.stdin.write(JSON.stringify(obj) + "\n");
    return true;
  }

  /** the runner new/unspecified clients get; created on demand */
  function defaultRunner() {
    let r = state.runners.get(state.defaultRunnerId);
    if (!r) {
      r = [...state.runners.values()].find((x) => x.proc) ?? [...state.runners.values()][0];
      if (!r) r = spawnRunner({ dir: state.currentDir });
      state.defaultRunnerId = r.id;
    }
    return r;
  }

  function runnerFromReq(url) {
    const id = url.searchParams.get("runner");
    return (id && state.runners.get(id)) || defaultRunner();
  }

  /** reuse the runner already attached to a session file, else spawn one */
  function openSessionRunner({ sessionPath = null, dir = null }) {
    if (sessionPath) {
      for (const r of state.runners.values()) {
        if (r.sessionFile === sessionPath) {
          if (!r.proc) startRunner(r);
          return r;
        }
      }
    }
    return spawnRunner({ dir: dir || state.currentDir, sessionPath });
  }

  // legacy entry points used by server.mjs
  function startPi() { defaultRunner(); }
  function stopPi() { for (const r of state.runners.values()) stopRunner(r); }

  // one-time migration from the single-process era: a pre-runner pi process
  // may survive a hot reload as state.pi; its stdout listeners belong to old
  // code, so retire it and let runners take over
  if (state.pi) {
    console.log("[pi-ui] retiring pre-runner pi process (multi-runner migration)");
    try { state.pi.kill("SIGTERM"); } catch {}
    state.pi = null;
  }

  // ---------------------------------------------------------------- background hublot agents

  /** Spawn a one-shot background pi agent (`pi -p`) that sets up whatever the
   *  hublot should expose, and notify clients when the port answers. */
  function spawnHublotAgent(tunnel, brief) {
    const prompt =
      `A public tunnel ${tunnel.url} forwards to http://localhost:${tunnel.port} on this machine.\n\n` +
      `Make the following available on local port ${tunnel.port} so it is reachable through the tunnel:\n${brief}\n\n` +
      `Whatever serves it must keep running after you exit: start it detached in the background ` +
      `(e.g. nohup … & disown) and verify it responds on port ${tunnel.port} before finishing.`;
    console.log(`[pi-ui] spawning background agent for hublot :${tunnel.port} (${tunnel.url})`);
    // --no-session: these one-shot setup runs must not leave session files
    // behind (they would clutter the sessions list)
    const proc = spawn(config.PI_BIN, ["--no-session", "-p", prompt], {
      cwd: state.currentDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    tunnel.agentProc = proc; // so deleting the hublot can kill it
    let tail = "";
    const onOut = (c) => { tail = (tail + String(c)).slice(-1500); };
    proc.stdout.on("data", onOut);
    proc.stderr.on("data", onOut);

    let done = false;
    let agentExited = false;
    const started = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000;

    /** the local port answering is not enough: the cloudflare edge can keep
     *  returning 502 for a few seconds after — wait until the PUBLIC url
     *  responds so previews don't capture an error page */
    async function publicUrlUp() {
      for (let i = 0; i < 15; i++) {
        try {
          const r = await fetch(tunnel.url, { method: "HEAD", signal: AbortSignal.timeout(3000) });
          if (r.status < 500) return true;
        } catch {}
        await new Promise((r) => setTimeout(r, 2000));
      }
      return false; // give up; report ready anyway (edge may just be slow)
    }

    const finish = (ok, error) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      if (ok) {
        // remember who serves the port so closing the hublot can kill it
        const pids = pidsOnPort(tunnel.port);
        if (pids.length) {
          tunnel.servicePid = pids[0];
          console.log(`[pi-ui] hublot :${tunnel.port} served by pid ${tunnel.servicePid}`);
        }
      }
      serverEvent(ok
        ? { type: "hublot_ready", tunnel: { id: tunnel.id, port: tunnel.port, url: tunnel.url, label: tunnel.label } }
        : { type: "hublot_failed", tunnel: { id: tunnel.id, port: tunnel.port, url: tunnel.url, label: tunnel.label }, error });
    };

    const checkPort = () => new Promise((resolvePromise) => {
      const sock = createConnection({ host: "127.0.0.1", port: tunnel.port, timeout: 1500 });
      sock.on("connect", () => { sock.destroy(); resolvePromise(true); });
      sock.on("error", () => resolvePromise(false));
      sock.on("timeout", () => { sock.destroy(); resolvePromise(false); });
    });

    let confirming = false;
    const poll = setInterval(async () => {
      if (done || confirming) return;
      if (await checkPort()) {
        confirming = true;
        await publicUrlUp();
        finish(true);
        return;
      }
      // give a just-exited agent a short grace period before declaring failure
      if (agentExited && Date.now() - agentExitAt > 10_000) {
        finish(false, `agent finished but nothing answers on port ${tunnel.port}: ${tail.trim().split("\n").pop() ?? ""}`);
      }
      if (Date.now() - started > TIMEOUT_MS) finish(false, "timed out waiting for the hublot to come up");
    }, 2000);

    let agentExitAt = 0;
    proc.on("exit", (code) => {
      agentExited = true;
      agentExitAt = Date.now();
      console.log(`[pi-ui] hublot agent for :${tunnel.port} exited (code=${code})`);
    });
    proc.on("error", (err) => finish(false, `failed to spawn background agent: ${err.message}`));
    proc.unref();
  }

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

  function checkAuth(req, url) {
    const candidates = authCandidates(req, url);
    if (Object.values(candidates).some(tokenMatches)) return true;
    // diagnostic: show which credentials arrived (masked) so stripped headers are visible
    const seen = Object.entries(candidates)
      .map(([k, v]) => `${k}=${v ? `${String(v).slice(0, 4)}…(${String(v).length})` : "-"}`)
      .join(" ");
    console.log(`[auth-fail] ${req.method} ${url.pathname} from ${req.socket.remoteAddress} | ${seen} | ua=${req.headers["user-agent"] ?? "-"}`);
    return false;
  }

  // ---------------------------------------------------------------- session listing

  /** pi stores sessions per working directory: ~/.pi/agent/sessions/--<cwd with
   *  separators mapped to "-">--/<timestamp>_<id>.jsonl */
  function sessionDirFor(cwd) {
    const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    return join(homedir(), ".pi", "agent", "sessions", safePath);
  }

  function summarizeSessionFile(path) {
    const text = readFileSync(path, "utf8");
    let id = null, createdAt = null, name = null, firstUserText = null, messageCount = 0, cwd = null, parentSession = null;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type === "session") { id = entry.id; createdAt = entry.timestamp; cwd = entry.cwd ?? null; parentSession = entry.parentSession ?? null; }
      else if (entry.type === "session_info") { name = entry.name ?? name; }
      else if (entry.type === "message") {
        const m = entry.message;
        if (m?.role === "user" || m?.role === "assistant") messageCount++;
        if (!firstUserText && m?.role === "user") {
          const c = m.content;
          firstUserText = typeof c === "string"
            ? c
            : c?.find?.((b) => b.type === "text")?.text ?? null;
        }
      }
    }
    return { id, createdAt, name, cwd, parentSession, preview: firstUserText?.slice(0, 120) ?? null, messageCount };
  }

  function listSessions(dir = sessionDirFor(state.currentDir)) {
    if (!existsSync(dir)) return [];
    const sessions = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".jsonl")) continue;
      const path = join(dir, file);
      try {
        const summary = summarizeSessionFile(path);
        sessions.push({ path, modifiedAt: statSync(path).mtime.toISOString(), ...summary });
      } catch (e) {
        console.error(`[pi-ui] failed to read session ${file}: ${e.message}`);
      }
    }
    sessions.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
    return sessions;
  }

  // ---------------------------------------------------------------- search

  const SESSIONS_ROOT = join(homedir(), ".pi", "agent", "sessions");

  /** best-effort human-readable name for a session folder like
   *  "--home-ubuntu-tree-pi--" -> "/home/ubuntu/tree-pi" (lossy for dashes) */
  function decodeFolderName(name) {
    return "/" + name.replace(/^--/, "").replace(/--$/, "").replace(/-/g, "/");
  }

  function listSessionFolders() {
    if (!existsSync(SESSIONS_ROOT)) return [];
    return readdirSync(SESSIONS_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        let count = 0;
        try { count = readdirSync(join(SESSIONS_ROOT, e.name)).filter((f) => f.endsWith(".jsonl")).length; } catch {}
        return { dir: join(SESSIONS_ROOT, e.name), name: e.name, label: decodeFolderName(e.name), count };
      })
      .filter((f) => f.count > 0)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Pull searchable text blocks out of one jsonl entry. */
  function entryTexts(e) {
    const out = [];
    if (e.type === "message") {
      const m = e.message ?? {};
      const c = m.content;
      if (typeof c === "string") out.push({ role: m.role, kind: "text", text: c });
      else if (Array.isArray(c)) {
        for (const b of c) {
          if (b.type === "text" && b.text) out.push({ role: m.role, kind: "text", text: b.text });
          else if (b.type === "thinking" && b.thinking) out.push({ role: m.role, kind: "thinking", text: b.thinking });
          else if (b.type === "toolCall") out.push({ role: m.role, kind: "toolCall", text: `${b.name} ${JSON.stringify(b.arguments ?? {})}` });
        }
      }
    } else if (e.type === "session_info" && e.name) {
      out.push({ role: "meta", kind: "name", text: e.name });
    }
    return out;
  }

  function makeSnippet(text, idx, qLen, ctx = 70) {
    const start = Math.max(0, idx - ctx);
    const end = Math.min(text.length, idx + qLen + ctx);
    return {
      before: (start > 0 ? "…" : "") + text.slice(start, idx).replace(/\s+/g, " "),
      match: text.slice(idx, idx + qLen),
      after: text.slice(idx + qLen, end).replace(/\s+/g, " ") + (end < text.length ? "…" : ""),
    };
  }

  function searchSessionFile(path, query, maxHitsPerFile = 25) {
    const q = query.toLowerCase();
    let text;
    try { text = readFileSync(path, "utf8"); } catch { return []; }
    const hits = [];
    let meta = { id: null, name: null, preview: null, cwd: null };
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "session") { meta.id = e.id; meta.cwd = e.cwd ?? null; continue; }
      if (e.type === "session_info") meta.name = e.name ?? meta.name;
      for (const t of entryTexts(e)) {
        if (!meta.preview && t.role === "user" && t.kind === "text") meta.preview = t.text.slice(0, 120);
        const idx = t.text.toLowerCase().indexOf(q);
        if (idx === -1) continue;
        hits.push({
          entryId: e.id ?? null,
          role: t.role ?? null,
          kind: t.kind,
          timestamp: e.timestamp ?? null,
          snippet: makeSnippet(t.text, idx, q.length),
        });
        if (hits.length >= maxHitsPerFile) break;
      }
      if (hits.length >= maxHitsPerFile) break;
    }
    return hits.map((h) => ({ ...h, sessionMeta: meta }));
  }

  /**
   * scope:
   *   session -> path = a session .jsonl file
   *   folder  -> path = a folder under SESSIONS_ROOT (default: current workdir's)
   *   all     -> every folder under SESSIONS_ROOT
   */
  function searchSessions({ q, scope, path }, maxResults = 200) {
    const files = [];
    if (scope === "session") {
      files.push(path);
    } else {
      const dirs = scope === "all"
        ? listSessionFolders().map((f) => f.dir)
        : [path || sessionDirFor(state.currentDir)];
      for (const dir of dirs) {
        if (!existsSync(dir)) continue;
        for (const f of readdirSync(dir)) {
          if (f.endsWith(".jsonl")) files.push(join(dir, f));
        }
      }
    }
    // newest first
    files.sort().reverse();
    const results = [];
    let truncated = false;
    for (const file of files) {
      const hits = searchSessionFile(file, q);
      if (!hits.length) continue;
      const folderName = dirname(file).split("/").pop();
      for (const h of hits) {
        if (results.length >= maxResults) { truncated = true; break; }
        const { sessionMeta, ...rest } = h;
        results.push({
          ...rest,
          sessionPath: file,
          sessionId: sessionMeta.id,
          sessionName: sessionMeta.name,
          sessionPreview: sessionMeta.preview,
          sessionCwd: sessionMeta.cwd,
          folder: folderName,
          folderLabel: decodeFolderName(folderName),
        });
      }
      if (truncated) break;
    }
    return { results, truncated, filesSearched: files.length };
  }

  /** Parse a session .jsonl into tree nodes. Every entry has id/parentId, so
   *  forked conversations form real branches. */
  function sessionTree(path) {
    const text = readFileSync(path, "utf8");
    const nodes = [];
    let sessionMeta = null;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "session") { sessionMeta = { id: e.id, timestamp: e.timestamp, cwd: e.cwd }; continue; }
      if (!e.id) continue;
      const node = {
        id: e.id,
        parentId: e.parentId ?? null,
        type: e.type,
        timestamp: e.timestamp ?? null,
        role: null,
        label: null,
      };
      if (e.type === "message") {
        const m = e.message ?? {};
        node.role = m.role ?? null;
        const c = m.content;
        let textBlock = typeof c === "string" ? c : c?.find?.((b) => b.type === "text")?.text;
        if (!textBlock && Array.isArray(c)) {
          const tc = c.find((b) => b.type === "toolCall");
          if (tc) textBlock = `[tool: ${tc.name}]`;
          else if (c.find((b) => b.type === "toolResult" || m.role === "toolResult")) textBlock = "[tool result]";
          else if (c.find((b) => b.type === "thinking")) textBlock = "[thinking]";
        }
        node.label = (textBlock ?? "").slice(0, 200);
      } else if (e.type === "model_change") {
        node.label = `model → ${e.modelId ?? "?"}`;
      } else if (e.type === "thinking_level_change") {
        node.label = `thinking → ${e.thinkingLevel ?? "?"}`;
      } else if (e.type === "session_info") {
        node.label = `named: ${e.name ?? ""}`;
      } else {
        node.label = e.type;
      }
      nodes.push(node);
    }
    return { session: sessionMeta, nodes };
  }

  /** Locate a session .jsonl file from its session id, across every folder.
   *  Fast path: files are named <timestamp>_<id>.jsonl; fall back to reading
   *  each file's session header. */
  function findSessionById(id) {
    if (!existsSync(SESSIONS_ROOT)) return null;
    const folders = readdirSync(SESSIONS_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(SESSIONS_ROOT, e.name));
    for (const dir of folders) {
      let files;
      try { files = readdirSync(dir); } catch { continue; }
      for (const f of files) {
        if (f.endsWith(`_${id}.jsonl`) || f === `${id}.jsonl`) return join(dir, f);
      }
    }
    for (const dir of folders) {
      let files;
      try { files = readdirSync(dir); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const path = join(dir, f);
        try {
          for (const line of readFileSync(path, "utf8").split("\n", 5)) {
            if (!line.trim()) continue;
            const e = JSON.parse(line);
            if (e.type === "session") {
              if (e.id === id) return path;
              break;
            }
          }
        } catch {}
      }
    }
    return null;
  }

  /** Ordered user/assistant message entries of a session's ACTIVE branch
   *  (the chain from the last entry up to the root). These entry ids are the
   *  stable anchors used by message permalinks: the client zips them against
   *  its rendered transcript. */
  function sessionEntries(path) {
    const text = readFileSync(path, "utf8");
    const byId = new Map();
    let sessionId = null;
    let leafId = null; // last entry of the file = tip of the active branch
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "session") { sessionId = e.id; continue; }
      if (!e.id) continue;
      byId.set(e.id, e);
      leafId = e.id;
    }
    const chain = [];
    for (let cur = leafId ? byId.get(leafId) : null; cur; cur = cur.parentId ? byId.get(cur.parentId) : null) {
      chain.push(cur);
    }
    chain.reverse();
    const entries = [];
    for (const e of chain) {
      if (e.type !== "message") continue;
      const m = e.message ?? {};
      if (m.role !== "user" && m.role !== "assistant") continue;
      const c = m.content;
      let t = typeof c === "string" ? c : c?.find?.((b) => b.type === "text")?.text;
      if (!t && Array.isArray(c)) {
        const tc = c.find((b) => b.type === "toolCall");
        if (tc) t = `[tool: ${tc.name}]`;
        else if (c.find((b) => b.type === "thinking")) t = "[thinking]";
      }
      entries.push({ id: e.id, role: m.role, text: (t ?? "").slice(0, 200), timestamp: e.timestamp ?? null });
    }
    return { sessionId, leafId, entries };
  }

  // ---------------------------------------------------------------- checkpoints
  //
  // A checkpoint = one commit of every pending workdir change, anchored to the
  // session message it was taken at. Records live in ~/.pi/agent/checkpoints.json
  // ({ sessionId: [{ hash, anchorId, leafId, dir, sessionPath, … }] }) so they
  // survive restarts. Rolling back restores the workdir to the commit
  // (deterministically — no LLM involved) and opens a forked session whose
  // history ends at the checkpointed entry.

  const CHECKPOINTS_PATH = join(homedir(), ".pi", "agent", "checkpoints.json");

  function loadCheckpoints() {
    try { return JSON.parse(readFileSync(CHECKPOINTS_PATH, "utf8")); } catch { return {}; }
  }

  function saveCheckpoints(db) {
    try { writeFileSync(CHECKPOINTS_PATH, JSON.stringify(db, null, 2)); }
    catch (e) { console.error(`[pi-ui] failed to save checkpoints: ${e.message}`); }
  }

  /** anchor a commit to the session's current tip; returns the record or null */
  function recordCheckpoint(sessionPath, dir, { hash, message }) {
    const { sessionId, leafId, entries } = sessionEntries(sessionPath);
    const anchorId = entries[entries.length - 1]?.id ?? null; // last rendered message
    if (!sessionId || !anchorId || !hash) return null;
    const db = loadCheckpoints();
    const list = (db[sessionId] ??= []);
    let rec = list.find((c) => c.hash === hash && c.anchorId === anchorId);
    if (!rec) {
      rec = { hash, anchorId, leafId, dir, sessionPath, message: message ?? null, timestamp: new Date().toISOString() };
      list.push(rec);
      saveCheckpoints(db);
    }
    return rec;
  }

  /** Forked sessions are born with the placeholder name "\u23EA <hash>"; the
   *  first prompt sent to one replaces it with a short title based on that
   *  message, so forks read like what they went on to do. */
  function autoTitleFork(runner, cmd) {
    if (cmd.type !== "prompt" || typeof cmd.message !== "string") return;
    if (!/^\u23EA [0-9a-f]{4,12}$/.test(runner.sessionName ?? "")) return;
    const title = cmd.message.replace(/\s+/g, " ").trim();
    if (!title) return;
    const short = title.length > 42 ? title.slice(0, 41).trimEnd() + "\u2026" : title;
    sendToRunner(runner, { id: `_srv-${++srvSeq}`, type: "set_session_name", name: `\u23EA ${short}` }, { autostart: false });
    runner.sessionName = `\u23EA ${short}`; // optimistic until get_state confirms
    runnersChanged();
  }

  /** Deterministic session fork: copy the active-branch chain up to `leafId`
   *  into a new .jsonl (same entry ids, parentSession lineage) — the same
   *  shape pi's own /fork produces, minus any LLM involvement. */
  function forkSessionAt(sessionPath, leafId, forkedAtHash = null) {
    const text = readFileSync(sessionPath, "utf8");
    let header = null;
    const byId = new Map();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "session") { header = e; continue; }
      if (e.id) byId.set(e.id, e);
    }
    if (!header) throw new Error("session header missing");
    if (!byId.has(leafId)) throw new Error(`entry ${leafId} not found in session`);
    const chain = [];
    for (let cur = byId.get(leafId); cur; cur = cur.parentId ? byId.get(cur.parentId) : null) chain.push(cur);
    chain.reverse();
    const id = randomUUID();
    const now = new Date();
    const newHeader = { ...header, id, timestamp: now.toISOString(), parentSession: sessionPath,
      ...(forkedAtHash ? { forkedAtHash } : {}) }; // extra field: pi ignores it, the tree view uses it
    const path = join(dirname(sessionPath), `${now.toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`);
    writeFileSync(path, [newHeader, ...chain].map((e) => JSON.stringify(e)).join("\n") + "\n");
    return { path, id, entryIds: new Set(chain.map((e) => e.id)) };
  }

  /** header + name of one session file (cheap enough: session folders are small) */
  function readSessionHeaderInfo(path) {
    const text = readFileSync(path, "utf8");
    let header = null, name = null;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "session" && !header) header = e;
      else if (e.type === "session_info") name = e.name ?? name;
    }
    if (!header?.id) return null;
    return {
      path, id: header.id, name,
      cwd: header.cwd ?? null,
      createdAt: header.timestamp ?? null,
      parentSession: header.parentSession ?? null,
      forkedAtHash: header.forkedAtHash ?? null,
    };
  }

  /** The session family of `sessionPath` as a tree: walk parentSession links up
   *  to the root ancestor, then nest every descendant fork, with each session's
   *  checkpoint records attached. */
  function checkpointTree(sessionPath) {
    const dir = dirname(sessionPath);
    const infos = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      try {
        const info = readSessionHeaderInfo(join(dir, f));
        if (info) infos.push(info);
      } catch {}
    }
    const byPath = new Map(infos.map((i) => [i.path, i]));
    let root = byPath.get(sessionPath);
    if (!root) throw new Error("session not found in its folder");
    const seen = new Set();
    while (root.parentSession && byPath.has(root.parentSession) && !seen.has(root.path)) {
      seen.add(root.path);
      root = byPath.get(root.parentSession);
    }
    const db = loadCheckpoints();
    // forks inherit their ancestors' checkpoint records (so ↩ works inside
    // them), but the tree must not display those twice: each node only shows
    // checkpoints an ancestor hasn't already shown
    const build = (info, depth, shownAbove = new Set()) => {
      const all = db[info.id] ?? [];
      const key = (c) => `${c.hash}@${c.anchorId}`;
      const shown = new Set([...shownAbove, ...all.map(key)]);
      // legacy forks (pre-forkedAtHash headers): the newest record inherited
      // from an ancestor IS the checkpoint the fork was created from
      const inherited = all.filter((c) => shownAbove.has(key(c)));
      const forkedAtHash = info.forkedAtHash
        ?? (inherited.length
          ? inherited.reduce((a, b) => ((a.timestamp ?? "") > (b.timestamp ?? "") ? a : b)).hash
          : null);
      return {
        ...info,
        forkedAtHash,
        checkpoints: all
          .filter((c) => !shownAbove.has(key(c)))
          .map(({ hash, anchorId, message, timestamp }) => ({ hash, anchorId, message, timestamp })),
        children: depth > 25 ? [] : infos
          .filter((i) => i.parentSession === info.path)
          .sort((a, b) => ((a.createdAt ?? "") < (b.createdAt ?? "") ? -1 : 1))
          .map((i) => build(i, depth + 1, shown)),
      };
    };
    return { root: build(root, 0) };
  }

  /** run git in a workdir; resolves with { code, stdout, stderr } (never rejects) */
  function git(dir, args) {
    return new Promise((resolvePromise) => {
      execFile("git", args, { cwd: dir, timeout: 30_000 }, (err, stdout, stderr) => {
        resolvePromise({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
      });
    });
  }

  /** Ask a one-shot pi sub-agent (no tools, no session) to summarize a staged
   *  diff into a single commit-message line. Resolves null on any failure so
   *  the caller can fall back to a timestamp message. */
  function summarizeDiff(dir, model, diff) {
    return new Promise((resolvePromise) => {
      const prompt =
        "You are writing a git commit message for a checkpoint commit.\n" +
        "Summarize the following diff as ONE concise line: imperative mood, max 72 characters.\n" +
        "Reply with ONLY that line — no quotes, no code fences, no explanation.\n\n" +
        `<diff>\n${diff}\n</diff>`;
      const args = ["--no-session", "--no-tools", "--thinking", "off", "--model", model, "-p", prompt];
      console.log(`[pi-ui] checkpoint summary sub-agent (${model}) for ${dir}`);
      const proc = spawn(config.PI_BIN, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      proc.stdout.on("data", (c) => { out += c; });
      proc.stderr.on("data", (c) => { err += c; });
      const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 60_000);
      timer.unref?.();
      proc.on("error", () => { clearTimeout(timer); resolvePromise(null); });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          console.error(`[pi-ui] summary sub-agent failed (code=${code}): ${err.trim().split("\n").pop() ?? ""}`);
          resolvePromise(null);
          return;
        }
        // first meaningful line, stripped of quotes/fences, length-capped
        const line = out.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("```"))[0] ?? "";
        const clean = line.replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
        resolvePromise(clean || null);
      });
    });
  }

  /** Commit every pending change in `dir` as a checkpoint commit. With a
   *  `model`, the staged diff is summarized into the commit message; `label`
   *  is the fallback message (before the timestamp) when there is no model
   *  or the sub-agent fails. */
  async function checkpointWorkdir(dir, label, model = null) {
    const top = await git(dir, ["rev-parse", "--show-toplevel"]);
    if (top.code !== 0) return { status: 400, body: { error: `not a git repository: ${dir}` } };
    const st = await git(dir, ["status", "--porcelain"]);
    if (st.code !== 0) return { status: 500, body: { error: `git status failed: ${st.stderr.trim()}` } };
    const files = st.stdout.split("\n").filter(Boolean).length;
    if (!files) {
      // clean tree: nothing to commit, but HEAD still marks this exact state;
      // carry its subject so the tree can label the checkpoint
      const head = (await git(dir, ["rev-parse", "--short", "HEAD"])).stdout.trim();
      const subject = (await git(dir, ["log", "-1", "--format=%s"])).stdout.trim();
      return { status: 200, body: { committed: false, reason: "workdir is clean", hash: head || undefined, message: subject || undefined } };
    }
    const add = await git(dir, ["add", "-A"]);
    if (add.code !== 0) return { status: 500, body: { error: `git add failed: ${add.stderr.trim()}` } };
    let message = null;
    let summarized = false;
    if (model) {
      const diff = (await git(dir, ["diff", "--cached"])).stdout.slice(0, 40_000);
      const summary = diff.trim() ? await summarizeDiff(dir, model, diff) : null;
      if (summary) { message = `checkpoint: ${summary}`; summarized = true; }
    }
    if (!message && label) message = `checkpoint: ${label}`;
    message ??= `checkpoint ${new Date().toISOString()}`;
    const ci = await git(dir, ["commit", "-m", message]);
    if (ci.code !== 0) {
      return { status: 500, body: { error: `git commit failed: ${(ci.stderr || ci.stdout).trim()}` } };
    }
    const hash = (await git(dir, ["rev-parse", "--short", "HEAD"])).stdout.trim();
    console.log(`[pi-ui] checkpoint ${hash} in ${dir} (${files} files): ${message}`);
    return { status: 200, body: { committed: true, hash, message, files, dir, summarized } };
  }

  // ---------------------------------------------------------------- http helpers

  const INDEX_PATH = join(config.DIRNAME, "public", "index.html");

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

  // ---------------------------------------------------------------- request handler

  async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    // permalink routes are client-side: /s/<sessionId> and /s/<sessionId>/m/<entryId>
    // both serve the UI; the client parses the path and opens the session
    const isAppRoute = url.pathname === "/" || url.pathname === "/index.html" ||
      /^\/s\/[\w.-]+(\/m\/[\w.-]+)?$/.test(url.pathname);
    if (req.method === "GET" && isAppRoute) {
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
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, {
        ok: true,
        runners: [...state.runners.values()].map(runnerInfo),
        clients: state.sseClients.size,
        reloadCount: state.reloadCount,
      });
      return;
    }

    // debug: shows which auth credentials reached the server (and whether each
    // validates) without requiring auth — helps diagnose header-stripping proxies
    if (req.method === "GET" && url.pathname === "/authcheck") {
      const candidates = authCandidates(req, url);
      const report = {};
      for (const [k, v] of Object.entries(candidates)) {
        report[k] = v ? (tokenMatches(v) ? "valid" : `present-invalid(len=${String(v).length})`) : "absent";
      }
      json(res, 200, { authorized: Object.values(candidates).some(tokenMatches), credentials: report });
      return;
    }

    // everything below requires auth
    if (!checkAuth(req, url)) {
      json(res, 401, { error: "unauthorized" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
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
      // replay this runner's buffered events so the client can reconstruct
      // in-flight state
      if (url.searchParams.get("replay") !== "0") {
        for (const line of runner.buffer) res.write(`data: ${line}\n\n`);
      }
      res.write(`data: ${JSON.stringify({
        type: "replay_done", _server: true,
        runner: runner.id, piRunning: !!runner.proc, workdir: runner.dir,
        runners: [...state.runners.values()].map(runnerInfo),
      })}\n\n`);
      state.sseClients.add(res);
      // data pings (not SSE comments) so the client can detect a dead
      // connection: comments never reach onmessage, real events do
      const ping = setInterval(
        () => res.write(`data: {"type":"ping","_server":true}\n\n`),
        25000
      );
      req.on("close", () => {
        clearInterval(ping);
        state.sseClients.delete(res);
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/rpc") {
      const cmd = await readJsonBody(req, res);
      if (cmd === undefined) return;
      if (!cmd || typeof cmd !== "object" || typeof cmd.type !== "string") {
        json(res, 400, { error: "command must be an object with a string `type`" });
        return;
      }
      const runner = runnerFromReq(url);
      const ok = sendToRunner(runner, cmd);
      if (ok) autoTitleFork(runner, cmd);
      json(res, ok ? 202 : 503, ok ? { queued: true, runner: runner.id } : { error: "pi process unavailable" });
      return;
    }

    if (url.pathname === "/runners") {
      if (req.method === "GET") {
        json(res, 200, { runners: [...state.runners.values()].map(runnerInfo) });
        return;
      }
      if (req.method === "DELETE") {
        const runner = state.runners.get(String(url.searchParams.get("id") ?? ""));
        if (!runner) { json(res, 404, { error: "no such runner" }); return; }
        // stop the process but KEEP the runner entry: it remembers its
        // session, so the next rpc/prompt to it respawns pi and resumes
        stopRunner(runner);
        json(res, 200, { stopped: runner.id });
        return;
      }
      json(res, 405, { error: "method not allowed" });
      return;
    }

    // get-or-spawn a runner for a session (or a fresh session in a folder)
    if (req.method === "POST" && url.pathname === "/open-session") {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      let sessionPath = body?.sessionPath ? resolve(String(body.sessionPath)) : null;
      if (sessionPath && (!sessionPath.startsWith(SESSIONS_ROOT + "/") || !sessionPath.endsWith(".jsonl") || !existsSync(sessionPath))) {
        json(res, 400, { error: `not a session file: ${sessionPath}` });
        return;
      }
      let dir = body?.dir ? resolve(String(body.dir)) : null;
      if (dir) {
        let ok = false;
        try { ok = statSync(dir).isDirectory(); } catch {}
        if (!ok) { json(res, 400, { error: `not a directory: ${dir}` }); return; }
        state.currentDir = dir; // keep /sessions and /browse in this folder
      }
      const runner = openSessionRunner({ sessionPath, dir });
      json(res, 200, { runner: runnerInfo(runner) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/sessions") {
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
      const runners = [...state.runners.values()];
      const sessions = listSessions(dir).map((s) => {
        const r = runners.find((x) => x.sessionFile === s.path);
        return { ...s, runnerId: r?.id ?? null, alive: !!r?.proc, busy: !!r?.busy };
      });
      json(res, 200, { sessions });
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/session") {
      const target = resolve(String(url.searchParams.get("path") ?? ""));
      const sessionsRoot = join(homedir(), ".pi", "agent", "sessions");
      if (!target.startsWith(sessionsRoot + "/") || !target.endsWith(".jsonl") || !existsSync(target)) {
        json(res, 400, { error: `not a session file: ${target}` });
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
        try {
          for (const line of readFileSync(target, "utf8").split("\n")) {
            if (!line.trim()) continue;
            const e = JSON.parse(line);
            if (e.type === "session") { sessionId = e.id; break; }
          }
        } catch {}
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
      return;
    }

    if (req.method === "GET" && url.pathname === "/session-tree") {
      const target = resolve(String(url.searchParams.get("path") ?? ""));
      const sessionsRoot = join(homedir(), ".pi", "agent", "sessions");
      if (!target.startsWith(sessionsRoot + "/") || !target.endsWith(".jsonl") || !existsSync(target)) {
        json(res, 400, { error: `not a session file: ${target}` });
        return;
      }
      try {
        json(res, 200, sessionTree(target));
      } catch (e) {
        json(res, 500, { error: `failed to parse session: ${e.message}` });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/session-by-id") {
      const id = String(url.searchParams.get("id") ?? "").trim();
      if (!id) { json(res, 400, { error: "id required" }); return; }
      const path = findSessionById(id);
      if (!path) { json(res, 404, { error: `no session with id ${id}` }); return; }
      try {
        json(res, 200, { session: { path, ...summarizeSessionFile(path) } });
      } catch (e) {
        json(res, 500, { error: `failed to read session: ${e.message}` });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/session-entries") {
      const target = resolve(String(url.searchParams.get("path") ?? ""));
      if (!target.startsWith(SESSIONS_ROOT + "/") || !target.endsWith(".jsonl") || !existsSync(target)) {
        json(res, 400, { error: `not a session file: ${target}` });
        return;
      }
      try {
        json(res, 200, sessionEntries(target));
      } catch (e) {
        json(res, 500, { error: `failed to parse session: ${e.message}` });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/session-folders") {
      // ?dir= reports "current" relative to that working directory
      const forDir = url.searchParams.get("dir") ? resolve(String(url.searchParams.get("dir"))) : state.currentDir;
      json(res, 200, { folders: listSessionFolders(), current: sessionDirFor(forDir) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/search") {
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
      try {
        json(res, 200, { q, scope, ...searchSessions({ q, scope, path }) });
      } catch (e) {
        json(res, 500, { error: `search failed: ${e.message}` });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/browse") {
      const target = resolve(url.searchParams.get("path") || state.currentDir);
      let entries;
      try {
        entries = readdirSync(target, { withFileTypes: true });
      } catch (e) {
        json(res, 400, { error: `cannot read ${target}: ${e.message}` });
        return;
      }
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
      // files are only needed by the attach-file picker (?files=1)
      let files;
      if (url.searchParams.get("files") === "1") {
        files = entries
          .filter((e) => e.isFile() && !e.name.startsWith("."))
          .map((e) => {
            let size = null;
            try { size = statSync(join(target, e.name)).size; } catch {}
            return { name: e.name, size };
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
      return;
    }

    // ---- built-in file explorer: download / read / save arbitrary files

    if (req.method === "GET" && url.pathname === "/file-download") {
      const target = resolve(String(url.searchParams.get("path") ?? ""));
      let st;
      try { st = statSync(target); } catch (e) { json(res, 404, { error: e.message }); return; }
      if (!st.isFile()) { json(res, 400, { error: "not a file" }); return; }
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": st.size,
        "content-disposition": `attachment; filename="${target.split("/").pop().replace(/"/g, "'")}"`,
      });
      createReadStream(target).pipe(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/file-content") {
      const target = resolve(String(url.searchParams.get("path") ?? ""));
      let st;
      try { st = statSync(target); } catch (e) { json(res, 404, { error: e.message }); return; }
      if (!st.isFile()) { json(res, 400, { error: "not a file" }); return; }
      if (st.size > 2 * 1024 * 1024) { json(res, 413, { error: `file too large to edit in browser (${st.size} bytes)` }); return; }
      const buf = readFileSync(target);
      if (buf.includes(0)) { json(res, 415, { error: "binary file — download it instead" }); return; }
      json(res, 200, { path: target, content: buf.toString("utf8") });
      return;
    }

    if (req.method === "POST" && url.pathname === "/file-save") {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const target = resolve(String(body?.path ?? ""));
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
      return;
    }

    if (req.method === "POST" && url.pathname === "/file-upload") {
      // raw body upload: ?dir=<target folder>&name=<file name>
      const dir = resolve(String(url.searchParams.get("dir") ?? ""));
      const name = String(url.searchParams.get("name") ?? "").trim();
      if (!name || name === "." || name === ".." || /[/\\]/.test(name)) {
        json(res, 400, { error: "invalid file name" });
        return;
      }
      let dirOk = false;
      try { dirOk = statSync(dir).isDirectory(); } catch {}
      if (!dirOk) { json(res, 400, { error: `not a directory: ${dir}` }); return; }
      let buf;
      try { buf = await readRawBody(req); } catch (e) { json(res, 413, { error: e.message }); return; }
      const target = join(dir, name);
      try {
        writeFileSync(target, buf);
      } catch (e) {
        json(res, 500, { error: `upload failed: ${e.message}` });
        return;
      }
      console.log(`[pi-ui] file uploaded via explorer: ${target} (${buf.length} bytes)`);
      json(res, 200, { saved: target, bytes: buf.length });
      return;
    }

    if (req.method === "POST" && url.pathname === "/mkdir") {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const parent = resolve(String(body?.path ?? ""));
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
      return;
    }

    if (req.method === "POST" && url.pathname === "/workdir") {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const target = resolve(String(body?.path ?? ""));
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
      return;
    }

    if (url.pathname === "/tunnels") {
      if (req.method === "GET") {
        json(res, 200, { tunnels: listTunnels(state), bin: config.TUNNEL_BIN });
        return;
      }
      if (req.method === "POST") {
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
            spawnHublotAgent(live ?? tunnel, brief);
          }
          json(res, 201, { tunnel, agent: !!brief });
        } catch (e) {
          json(res, 502, { error: e.message });
        }
        return;
      }
      if (req.method === "PATCH") {
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
        return;
      }
      if (req.method === "DELETE") {
        const closed = closeTunnel(state, String(url.searchParams.get("id") ?? ""));
        if (!closed) {
          json(res, 404, { error: "no such tunnel" });
          return;
        }
        json(res, 200, { closed });
        return;
      }
      json(res, 405, { error: "method not allowed" });
      return;
    }

    if (url.pathname === "/routines") {
      if (req.method === "GET") {
        json(res, 200, { routines: listRoutines(state), dir: routinesDir() });
        return;
      }
      if (req.method === "POST") {
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
        return;
      }
      json(res, 405, { error: "method not allowed" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/checkpoint") {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const runner = runnerFromReq(url);
      const label = body?.label ? String(body.label).slice(0, 200) : null;
      const model = body?.model ? String(body.model).slice(0, 200) : null;
      const { status, body: out } = await checkpointWorkdir(runner.dir, label, model);
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
      return;
    }

    if (req.method === "GET" && url.pathname === "/checkpoints") {
      const id = String(url.searchParams.get("id") ?? "").trim();
      if (!id) { json(res, 400, { error: "id required" }); return; }
      json(res, 200, { checkpoints: loadCheckpoints()[id] ?? [] });
      return;
    }

    if (req.method === "GET" && url.pathname === "/checkpoint-tree") {
      const target = resolve(String(url.searchParams.get("path") ?? ""));
      if (!target.startsWith(SESSIONS_ROOT + "/") || !target.endsWith(".jsonl") || !existsSync(target)) {
        json(res, 400, { error: `not a session file: ${target}` });
        return;
      }
      try {
        json(res, 200, checkpointTree(target));
      } catch (e) {
        json(res, 500, { error: `tree failed: ${e.message}` });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/rollback") {
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
          const saved = await checkpointWorkdir(cp.dir, `auto before rollback to ${hash}`, model);
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
        sendToRunner(runner, { id: `_srv-${++srvSeq}`, type: "set_session_name", name: `\u23EA ${hash}` });
        runner.sessionName = `\u23EA ${hash}`; // optimistic — lets the first prompt auto-title the fork right away
        console.log(`[pi-ui] rolled back ${cp.dir} to ${hash}, forked session ${fork.id}`);
        json(res, 200, { rolledBack: hash, safety, fork: { id: fork.id, path: fork.path }, runner: runnerInfo(runner) });
      } catch (e) {
        json(res, 500, { error: `rollback failed: ${e.message}` });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/restart") {
      const runner = runnerFromReq(url);
      stopRunner(runner);
      setTimeout(() => { if (state.runners.has(runner.id)) startRunner(runner); }, 300);
      json(res, 202, { restarting: true, runner: runner.id });
      return;
    }

    json(res, 404, { error: "not found" });
  }

  return {
    handleRequest, startPi, stopPi,
    stopTunnels: () => closeAllTunnels(state),
    stopRoutines: () => stopAllRoutines(state),
  };
}
