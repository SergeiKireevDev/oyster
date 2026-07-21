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
 *   GET  /events      -> SSE stream of pi's stdout JSON lines
 *   POST /rpc         -> JSON command forwarded to pi's stdin
 *   GET  /sessions    -> saved pi sessions for the active workdir
 *   GET  /browse      -> list subdirectories for the folder picker
 *   POST /workdir     -> switch folder (respawns pi there)
 *   POST /mkdir       -> create a subdirectory (folder picker "new folder")
 *   POST /restart     -> kill and respawn the pi process
 */

import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";

export function init(state) {
  const { config, broadcast, serverEvent } = state;

  // ---------------------------------------------------------------- pi process

  function startPi() {
    if (state.pi) return;
    const now = Date.now();
    // basic crash-loop guard: if pi died within 2s of spawning, wait before retry
    if (now - state.lastSpawnAt < 2000 && state.piStartCount > 0) {
      setTimeout(() => {
        if (!state.pi) startPi();
      }, 2000);
      return;
    }
    state.lastSpawnAt = now;
    state.piStartCount++;
    const args = ["--mode", "rpc", ...config.PI_EXTRA_ARGS];
    console.log(`[pi-ui] spawning: ${config.PI_BIN} ${args.join(" ")} (cwd: ${state.currentDir})`);
    const pi = spawn(config.PI_BIN, args, { cwd: state.currentDir, stdio: ["pipe", "pipe", "pipe"] });
    state.pi = pi;

    const rl = createInterface({ input: pi.stdout });
    rl.on("line", (line) => {
      line = line.trim();
      if (line) broadcast(line);
    });

    pi.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) console.error(`[pi stderr] ${text}`);
    });

    pi.on("error", (err) => {
      console.error(`[pi-ui] failed to spawn pi: ${err.message}`);
      serverEvent({ type: "pi_error", error: err.message });
      if (state.pi === pi) state.pi = null;
    });

    pi.on("exit", (code, signal) => {
      console.log(`[pi-ui] pi exited (code=${code}, signal=${signal})`);
      serverEvent({ type: "pi_exit", code, signal });
      if (state.pi === pi) state.pi = null;
    });

    serverEvent({ type: "pi_started", startCount: state.piStartCount });
  }

  function stopPi() {
    const proc = state.pi;
    if (!proc) return;
    state.pi = null;
    proc.removeAllListeners("exit");
    proc.on("exit", () => serverEvent({ type: "pi_exit", code: null, signal: "SIGTERM" }));
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) proc.kill("SIGKILL");
    }, 3000).unref();
  }

  function sendToPi(obj) {
    if (!state.pi) startPi();
    if (!state.pi || !state.pi.stdin.writable) return false;
    state.pi.stdin.write(JSON.stringify(obj) + "\n");
    return true;
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
    let id = null, createdAt = null, name = null, firstUserText = null, messageCount = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type === "session") { id = entry.id; createdAt = entry.timestamp; }
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
    return { id, createdAt, name, preview: firstUserText?.slice(0, 120) ?? null, messageCount };
  }

  function listSessions() {
    const dir = sessionDirFor(state.currentDir);
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
        piRunning: !!state.pi,
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
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(`: connected\n\n`);
      // replay buffered events so the client can reconstruct in-flight state
      if (url.searchParams.get("replay") !== "0") {
        for (const line of state.eventBuffer) res.write(`data: ${line}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: "replay_done", _server: true, piRunning: !!state.pi, workdir: state.currentDir })}\n\n`);
      state.sseClients.add(res);
      const ping = setInterval(() => res.write(`: ping\n\n`), 25000);
      req.on("close", () => {
        clearInterval(ping);
        state.sseClients.delete(res);
      });
      startPi();
      return;
    }

    if (req.method === "POST" && url.pathname === "/rpc") {
      const cmd = await readJsonBody(req, res);
      if (cmd === undefined) return;
      if (!cmd || typeof cmd !== "object" || typeof cmd.type !== "string") {
        json(res, 400, { error: "command must be an object with a string `type`" });
        return;
      }
      const ok = sendToPi(cmd);
      json(res, ok ? 202 : 503, ok ? { queued: true } : { error: "pi process unavailable" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/sessions") {
      json(res, 200, { sessions: listSessions() });
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
      json(res, 200, {
        path: target,
        parent: dirname(target) === target ? null : dirname(target),
        dirs,
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
      console.log(`[pi-ui] workdir changed to ${state.currentDir}, respawning pi`);
      stopPi();
      serverEvent({ type: "workdir_changed", workdir: state.currentDir });
      setTimeout(startPi, 300);
      json(res, 202, { workdir: state.currentDir });
      return;
    }

    if (req.method === "POST" && url.pathname === "/restart") {
      stopPi();
      setTimeout(startPi, 300);
      json(res, 202, { restarting: true });
      return;
    }

    json(res, 404, { error: "not found" });
  }

  return { handleRequest, startPi, stopPi };
}
