#!/usr/bin/env node
/**
 * pi-remote-ui server
 *
 * Bridges a browser to a `pi --mode rpc` child process:
 *   - GET  /            -> static UI (public/index.html)
 *   - GET  /events      -> Server-Sent Events stream of pi's stdout JSON lines (auth required)
 *   - POST /rpc         -> JSON command forwarded to pi's stdin (auth required)
 *   - POST /restart     -> kill and respawn the pi process (auth required)
 *   - GET  /health      -> liveness probe (no auth)
 *
 * Zero runtime dependencies. SSE + POST (rather than WebSocket) so it works
 * through any HTTP tunnel without special upgrade handling.
 *
 * Config (env or flags):
 *   PORT / --port <n>        listen port            (default 8081)
 *   HOST / --host <addr>     bind address           (default 0.0.0.0)
 *   PI_UI_TOKEN / --token    auth token             (default: generated, printed on startup)
 *   PI_DIR / --dir <path>    working dir for pi     (default: cwd)
 *   PI_BIN / --pi <path>     pi executable          (default: "pi")
 *   --pi-args "..."          extra args appended to `pi --mode rpc`
 */

import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import http from "node:http";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- config

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const PORT = Number(argValue("--port") ?? process.env.PORT ?? 8080);
const HOST = argValue("--host") ?? process.env.HOST ?? "0.0.0.0";
const PI_BIN = argValue("--pi") ?? process.env.PI_BIN ?? "pi";
const PI_DIR = resolve(argValue("--dir") ?? process.env.PI_DIR ?? process.cwd());
const PI_EXTRA_ARGS = (argValue("--pi-args") ?? process.env.PI_ARGS ?? "")
  .split(" ")
  .filter(Boolean);
function defaultToken() {
  // reuse .ui-token next to the server so restarts keep a stable token
  const tokenFile = join(__dirname, ".ui-token");
  if (existsSync(tokenFile)) {
    const t = readFileSync(tokenFile, "utf8").trim();
    if (t) return t;
  }
  return randomBytes(16).toString("hex");
}

const TOKEN = argValue("--token") ?? process.env.PI_UI_TOKEN ?? defaultToken();

// ---------------------------------------------------------------- pi process

/** @type {import("node:child_process").ChildProcess | null} */
let pi = null;
let piStartCount = 0;
let lastSpawnAt = 0;

/** Recent stdout lines replayed to newly connected clients so a page refresh
 *  mid-stream doesn't lose in-flight tool/event context. */
const eventBuffer = [];
const EVENT_BUFFER_MAX = 500;

const sseClients = new Set();

function broadcast(line) {
  eventBuffer.push(line);
  if (eventBuffer.length > EVENT_BUFFER_MAX) eventBuffer.shift();
  for (const res of sseClients) {
    res.write(`data: ${line}\n\n`);
  }
}

function serverEvent(obj) {
  broadcast(JSON.stringify({ ...obj, _server: true }));
}

function startPi() {
  if (pi) return;
  const now = Date.now();
  // basic crash-loop guard: if pi died within 2s of spawning, wait before retry
  if (now - lastSpawnAt < 2000 && piStartCount > 0) {
    setTimeout(() => {
      if (!pi) startPi();
    }, 2000);
    return;
  }
  lastSpawnAt = now;
  piStartCount++;
  const args = ["--mode", "rpc", ...PI_EXTRA_ARGS];
  console.log(`[pi-ui] spawning: ${PI_BIN} ${args.join(" ")} (cwd: ${PI_DIR})`);
  pi = spawn(PI_BIN, args, { cwd: PI_DIR, stdio: ["pipe", "pipe", "pipe"] });

  const rl = createInterface({ input: pi.stdout });
  rl.on("line", (line) => {
    line = line.trim();
    if (!line) return;
    broadcast(line);
  });

  pi.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) console.error(`[pi stderr] ${text}`);
  });

  pi.on("error", (err) => {
    console.error(`[pi-ui] failed to spawn pi: ${err.message}`);
    serverEvent({ type: "pi_error", error: err.message });
    pi = null;
  });

  pi.on("exit", (code, signal) => {
    console.log(`[pi-ui] pi exited (code=${code}, signal=${signal})`);
    serverEvent({ type: "pi_exit", code, signal });
    pi = null;
  });

  serverEvent({ type: "pi_started", startCount: piStartCount });
}

function stopPi() {
  if (!pi) return;
  const proc = pi;
  pi = null;
  proc.removeAllListeners("exit");
  proc.on("exit", () => serverEvent({ type: "pi_exit", code: null, signal: "SIGTERM" }));
  proc.kill("SIGTERM");
  setTimeout(() => {
    if (proc.exitCode === null && !proc.killed) proc.kill("SIGKILL");
  }, 3000).unref();
}

function sendToPi(obj) {
  if (!pi) startPi();
  if (!pi || !pi.stdin.writable) return false;
  pi.stdin.write(JSON.stringify(obj) + "\n");
  return true;
}

// ---------------------------------------------------------------- auth

const tokenBuf = Buffer.from(TOKEN);

function checkAuth(req, url) {
  let provided = url.searchParams.get("token");
  if (!provided) {
    const header = req.headers["authorization"];
    if (header?.startsWith("Bearer ")) provided = header.slice(7);
  }
  if (!provided) provided = req.headers["x-auth-token"];
  if (!provided) return false;
  const buf = Buffer.from(String(provided));
  return buf.length === tokenBuf.length && timingSafeEqual(buf, tokenBuf);
}

// ---------------------------------------------------------------- http

const INDEX_PATH = join(__dirname, "public", "index.html");

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    if (!existsSync(INDEX_PATH)) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("public/index.html missing");
      return;
    }
    const html = readFileSync(INDEX_PATH);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
    });
    res.end(html);
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, piRunning: !!pi, clients: sseClients.size });
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
      for (const line of eventBuffer) res.write(`data: ${line}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: "replay_done", _server: true, piRunning: !!pi, workdir: PI_DIR })}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => res.write(`: ping\n\n`), 25000);
    req.on("close", () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
    startPi();
    return;
  }

  if (req.method === "POST" && url.pathname === "/rpc") {
    let cmd;
    try {
      cmd = JSON.parse(await readBody(req));
    } catch (e) {
      json(res, 400, { error: `invalid JSON: ${e.message}` });
      return;
    }
    if (!cmd || typeof cmd !== "object" || typeof cmd.type !== "string") {
      json(res, 400, { error: "command must be an object with a string `type`" });
      return;
    }
    const ok = sendToPi(cmd);
    json(res, ok ? 202 : 503, ok ? { queued: true } : { error: "pi process unavailable" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/restart") {
    stopPi();
    setTimeout(startPi, 300);
    json(res, 202, { restarting: true });
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`[pi-ui] listening on http://${HOST}:${PORT}`);
  console.log(`[pi-ui] pi working directory: ${PI_DIR}`);
  console.log(`[pi-ui] auth token: ${TOKEN}`);
  console.log(`[pi-ui] open: http://localhost:${PORT}/#token=${TOKEN}`);
  startPi();
});

process.on("SIGINT", () => {
  stopPi();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopPi();
  process.exit(0);
});
