/**
 * pi-remote-ui — hot-reloadable application logic
 *
 * Loaded by server.mjs (the stable core) via dynamic import. Everything here
 * can be edited while the server runs; the core re-imports this module on
 * change and swaps the handler atomically. All state that must survive a
 * reload (pi process, SSE clients, event buffer, config) lives in the `state`
 * object owned by the core — this module only reads/writes it.
 *
 * Routes:
 *   GET  /            -> static UI (public/index.html)              (no auth)
 *   GET  /health      -> liveness probe                             (no auth)
 *   GET  /authcheck   -> which credentials arrived + validity       (no auth)
 *   GET  /events      -> SSE stream of one runner's stdout (?runner=id)
 *   POST /rpc         -> JSON command forwarded to a runner (?runner=id)
 *   GET  /runners     -> list live pi runners (one process per session)
 *   DELETE /runners   -> stop a runner (?id=…)
 *   POST /open-session -> get-or-spawn a runner { sessionPath?, dir? }
 *   GET  /sessions    -> saved pi sessions for the active workdir
 *   GET  /session-tree -> entries of one session as tree nodes (id/parentId)
 *   GET  /session-folders -> all folders under ~/.pi/agent/sessions
 *   GET  /search      -> full-text search (?q=…&scope=session|folder|all[&path=…])
 *   GET  /browse      -> list subdirectories for the folder picker
 *   POST /workdir     -> switch folder (spawns a new runner there)
 *   POST /mkdir       -> create a subdirectory (folder picker "new folder")
 *   POST /restart     -> kill and respawn one runner (?runner=id)
 *   GET  /tunnels     -> live tunnels spawned by this server
 *   POST /tunnels     -> open a tunnel { port, label?, sessionId? } (cloudflared quick tunnel)
 *   DELETE /tunnels   -> close a tunnel (?id=…)
 */

import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// import tunnels.mjs with a cache-busting query so hot reloads of app.mjs
// pick up the current version instead of a stale cached module
const TUNNELS_PATH = join(dirname(fileURLToPath(import.meta.url)), "tunnels.mjs");
const { listTunnels, openTunnel, closeTunnel, closeAllTunnels } =
  await import(`./tunnels.mjs?v=${statSync(TUNNELS_PATH).mtimeMs}`);

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
    // requested sessionPath also land here)
    if (runner.sessionFile) {
      sendToRunner(runner, { id: `_srv-${++srvSeq}`, type: "switch_session", sessionPath: runner.sessionFile }, { autostart: false });
    }
    requestState(runner);
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
    let id = null, createdAt = null, name = null, firstUserText = null, messageCount = 0, cwd = null;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type === "session") { id = entry.id; createdAt = entry.timestamp; cwd = entry.cwd ?? null; }
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
    return { id, createdAt, name, cwd, preview: firstUserText?.slice(0, 120) ?? null, messageCount };
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

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
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
        stopRunner(runner);
        state.runners.delete(runner.id);
        if (state.defaultRunnerId === runner.id) state.defaultRunnerId = null;
        runnersChanged();
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
      // ?path= lists another sessions folder (must live under the sessions root)
      let dir;
      if (url.searchParams.get("path")) {
        dir = resolve(String(url.searchParams.get("path")));
        if (!dir.startsWith(SESSIONS_ROOT)) {
          json(res, 400, { error: "folder must be under the sessions root" });
          return;
        }
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
        unlinkSync(target);
        json(res, 200, { deleted: target });
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

    if (req.method === "GET" && url.pathname === "/session-folders") {
      json(res, 200, { folders: listSessionFolders(), current: sessionDirFor(state.currentDir) });
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
          if (!state.nextIfacePort) state.nextIfacePort = 3000;
          const used = new Set([...(state.tunnels?.values() ?? [])].map((t) => t.port));
          while (used.has(state.nextIfacePort)) state.nextIfacePort++;
          port = state.nextIfacePort++;
        }
        try {
          const tunnel = await openTunnel(state, {
            port,
            label: body?.label ? String(body.label).slice(0, 200) : null,
            sessionId: body?.sessionId ? String(body.sessionId).slice(0, 100) : null,
          });
          json(res, 201, { tunnel });
        } catch (e) {
          json(res, 502, { error: e.message });
        }
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

    if (req.method === "POST" && url.pathname === "/restart") {
      const runner = runnerFromReq(url);
      stopRunner(runner);
      setTimeout(() => { if (state.runners.has(runner.id)) startRunner(runner); }, 300);
      json(res, 202, { restarting: true, runner: runner.id });
      return;
    }

    json(res, 404, { error: "not found" });
  }

  return { handleRequest, startPi, stopPi, stopTunnels: () => closeAllTunnels(state) };
}
