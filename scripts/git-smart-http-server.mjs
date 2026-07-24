#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

const usage = `Usage: serve-git-smart-http.sh [--host HOST] [--port PORT] [--state-dir DIR] WORKTREE

Serve a Git worktree as a read-only Smart HTTP repository. The server supports
clone, fetch, and pull at its root URL. Push/receive-pack is always denied.

Options:
  --host HOST       Listen address (default: 127.0.0.1)
  --port PORT       Listen port (default: 3000)
  --state-dir DIR   Persistent mirror/runtime directory (default: temporary)
  -h, --help        Show this help`;

function fail(message, { showUsage = false } = {}) {
  if (message) console.error(message);
  if (showUsage) console.error(usage);
  process.exit(2);
}

function parseArguments(argv) {
  let host = "127.0.0.1";
  let port = "3000";
  let stateDir = process.env.GIT_SMART_HTTP_STATE_DIR || "";
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") {
      console.log(usage);
      process.exit(0);
    }
    if (argument === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (["--host", "--port", "--state-dir"].includes(argument)) {
      const value = argv[index + 1];
      if (value == null || value === "") fail(`missing ${argument} value`, { showUsage: true });
      if (argument === "--host") host = value;
      if (argument === "--port") port = value;
      if (argument === "--state-dir") stateDir = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) fail(`Unknown option: ${argument}`, { showUsage: true });
    positional.push(...argv.slice(index));
    break;
  }
  if (positional.length !== 1) fail("", { showUsage: true });
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) fail(`Invalid port: ${port}`);
  return { host, port: Number(port), stateDir, worktree: positional[0] };
}

function git(arguments_, { cwd, allowFailure = false } = {}) {
  const result = spawnSync("git", arguments_, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${arguments_.join(" ")} failed`).trim());
  }
  return result;
}

const options = parseArguments(process.argv.slice(2));
if (!isAbsolute(options.worktree)) fail(`WORKTREE must be an absolute path: ${options.worktree}`);

let worktree;
try {
  worktree = realpathSync(options.worktree);
} catch (error) {
  fail(`Cannot resolve worktree ${options.worktree}: ${error.message}`);
}
if (git(["-C", worktree, "rev-parse", "--is-inside-work-tree"], { allowFailure: true }).status !== 0) {
  fail(`Not a Git worktree: ${worktree}`);
}

let cleanupState = false;
let stateDir;
try {
  if (options.stateDir) {
    mkdirSync(options.stateDir, { recursive: true });
    stateDir = realpathSync(options.stateDir);
  } else {
    stateDir = mkdtempSync(join(tmpdir(), "oyster-git-http."));
    cleanupState = true;
  }
} catch (error) {
  fail(`Cannot prepare Git server state: ${error.message}`);
}

const mirror = join(stateDir, "repository.git");
const projectRoot = dirname(mirror);
const repositoryName = basename(mirror);
let cleaned = false;
function cleanState() {
  if (cleaned || !cleanupState) return;
  cleaned = true;
  rmSync(stateDir, { recursive: true, force: true });
}
process.once("exit", cleanState);

try {
  if (!existsSync(mirror)) git(["clone", "--quiet", "--mirror", "--no-local", worktree, mirror]);
  git(["-C", mirror, "config", "http.receivepack", "false"]);
  git(["-C", mirror, "config", "daemon.receivepack", "false"]);
} catch (error) {
  cleanState();
  fail(`Cannot prepare Git mirror: ${error.message}`);
}

function syncMirror() {
  git([
    "-C", mirror, "fetch", "--quiet", "--prune", worktree,
    "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*",
  ]);
  const symbolic = git(["-C", worktree, "symbolic-ref", "-q", "HEAD"], { allowFailure: true });
  if (symbolic.status === 0) {
    git(["-C", mirror, "symbolic-ref", "HEAD", symbolic.stdout.trim()]);
  } else {
    const commit = git(["-C", worktree, "rev-parse", "HEAD"]).stdout.trim();
    git(["-C", mirror, "update-ref", "refs/heads/worktree-head", commit]);
    git(["-C", mirror, "symbolic-ref", "HEAD", "refs/heads/worktree-head"]);
  }
}

function sendText(response, status, body, method = "GET") {
  const content = Buffer.from(body);
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": content.length,
    "Cache-Control": "no-store",
    Connection: "close",
  });
  response.end(method === "HEAD" ? undefined : content);
}

const activeBackends = new Set();
function serveGit(request, response) {
  const parsed = new URL(request.url || "/", `http://${options.host}:${options.port}`);
  if (parsed.pathname === "/" && !parsed.searchParams.has("service") && ["GET", "HEAD"].includes(request.method)) {
    sendText(response, 200, "Oyster read-only Git Smart HTTP server\n", request.method);
    return;
  }
  if (parsed.pathname.includes("git-receive-pack") || parsed.searchParams.get("service") === "git-receive-pack") {
    sendText(response, 403, "Push is disabled\n", request.method);
    return;
  }
  if (!["GET", "HEAD", "POST"].includes(request.method)) {
    sendText(response, 405, "Method not allowed\n", request.method);
    return;
  }

  try {
    syncMirror();
  } catch (error) {
    sendText(response, 500, `${error.message || "Cannot synchronize repository"}\n`, request.method);
    return;
  }

  const pathInfo = `/${repositoryName}${parsed.pathname === "/" ? "/" : parsed.pathname}`;
  const environment = {
    ...process.env,
    GIT_PROJECT_ROOT: projectRoot,
    GIT_HTTP_EXPORT_ALL: "1",
    PATH_INFO: pathInfo,
    QUERY_STRING: parsed.search.slice(1),
    REQUEST_METHOD: request.method,
    CONTENT_TYPE: request.headers["content-type"] || "",
    CONTENT_LENGTH: request.headers["content-length"] || "",
    REMOTE_ADDR: request.socket.remoteAddress || "",
    SERVER_PROTOCOL: `HTTP/${request.httpVersion}`,
    SERVER_NAME: options.host,
    SERVER_PORT: String(options.port),
  };
  for (const [name, value] of Object.entries(request.headers)) {
    if (value == null || ["content-type", "content-length"].includes(name)) continue;
    environment[`HTTP_${name.toUpperCase().replaceAll("-", "_")}`] = Array.isArray(value) ? value.join(", ") : value;
  }

  const backend = spawn("git", ["http-backend"], { env: environment, stdio: ["pipe", "pipe", "pipe"] });
  activeBackends.add(backend);
  let diagnostics = "";
  let responseStarted = false;
  let headerBuffer = Buffer.alloc(0);

  const stopBackend = () => {
    if (backend.exitCode == null) backend.kill("SIGTERM");
  };
  request.once("aborted", stopBackend);
  request.once("error", stopBackend);
  response.once("close", () => {
    if (!response.writableEnded) stopBackend();
  });
  backend.stderr.setEncoding("utf8");
  backend.stderr.on("data", (chunk) => { diagnostics += chunk; });
  backend.once("error", (error) => {
    diagnostics += error.message;
    if (!response.headersSent) sendText(response, 500, `${error.message}\n`, request.method);
  });
  backend.once("close", (code) => {
    activeBackends.delete(backend);
    if (code && diagnostics) process.stderr.write(diagnostics);
    if (!responseStarted && !response.headersSent) {
      sendText(response, 502, `${diagnostics.trim() || "Git HTTP backend returned no response"}\n`, request.method);
    }
  });

  function readCgiHeaders(chunk) {
    headerBuffer = Buffer.concat([headerBuffer, chunk]);
    const crlfBoundary = headerBuffer.indexOf("\r\n\r\n");
    const newlineBoundary = headerBuffer.indexOf("\n\n");
    const boundary = crlfBoundary >= 0 ? crlfBoundary : newlineBoundary;
    const separatorLength = crlfBoundary >= 0 ? 4 : 2;
    if (boundary < 0) {
      if (headerBuffer.length > 64 * 1024) {
        backend.stdout.off("data", readCgiHeaders);
        stopBackend();
        sendText(response, 502, "Git HTTP backend returned oversized headers\n", request.method);
      }
      return;
    }

    backend.stdout.pause();
    backend.stdout.off("data", readCgiHeaders);
    const headerText = headerBuffer.subarray(0, boundary).toString("latin1");
    const initialBody = headerBuffer.subarray(boundary + separatorLength);
    let status = 200;
    const headers = {};
    for (const line of headerText.split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const name = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (name.toLowerCase() === "status") status = Number(value.split(" ", 1)[0]) || 200;
      else if (!["connection", "transfer-encoding"].includes(name.toLowerCase())) headers[name] = value;
    }
    headers.Connection = "close";
    responseStarted = true;
    response.writeHead(status, headers);
    if (request.method === "HEAD") {
      backend.stdout.resume();
      backend.stdout.once("end", () => response.end());
      return;
    }
    if (initialBody.length) response.write(initialBody);
    backend.stdout.pipe(response);
  }

  backend.stdout.on("data", readCgiHeaders);
  request.pipe(backend.stdin);
}

try {
  syncMirror();
} catch (error) {
  cleanState();
  fail(`Cannot synchronize Git mirror: ${error.message}`);
}

const server = createServer(serveGit);
server.on("clientError", (error, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  if (error.code !== "ECONNRESET") console.error(error.message);
});
server.once("error", (error) => {
  console.error(`Cannot start Git Smart HTTP server: ${error.message}`);
  cleanState();
  process.exitCode = 1;
});
server.listen(options.port, options.host, () => {
  console.log(`Git Smart HTTP serving ${worktree} at http://${options.host}:${options.port}/`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const backend of activeBackends) backend.kill("SIGTERM");
  server.close(() => {
    cleanState();
    process.exit(0);
  });
  server.closeAllConnections();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
