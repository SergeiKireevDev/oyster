#!/usr/bin/env node
/**
 * pi-lot-ui — stable core (hot-reload host)
 *
 * This file owns everything that must SURVIVE a code reload:
 *   - the listening HTTP socket
 *   - open SSE client responses (the browser connections)
 *   - the `pi` child process reference
 *   - the event replay buffer
 *   - config (port, token, dirs)
 *
 * All request handling / business logic lives in app.mjs, which is loaded
 * via dynamic import() with a cache-busting query string and re-imported
 * whenever it changes on disk. Swapping the handler is atomic; in-flight
 * SSE connections are untouched because their `res` objects live here.
 *
 * Keep this file as small as possible — changes to IT still need a restart.
 */

import { randomBytes } from "node:crypto";
import { accessSync, constants, readFileSync, readdirSync, existsSync, watch, statSync } from "node:fs";
import http from "node:http";
import { delimiter, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openAppStore } from "./persistence/appStore.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- config

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function defaultToken() {
  const tokenFile = join(__dirname, ".ui-token");
  if (existsSync(tokenFile)) {
    const t = readFileSync(tokenFile, "utf8").trim();
    if (t) return t;
  }
  return randomBytes(16).toString("hex");
}

function defaultTunnelBin() {
  // prefer a user-local install when cloudflared is not on the server's PATH
  const local = join(homedir(), ".local", "bin", "cloudflared");
  return existsSync(local) ? local : "cloudflared";
}

const DEFAULT_LOCAL_PI = "/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js";
const MIN_NODE_VERSION = [22, 19, 0];

function resolveExecutable(value) {
  if (value.includes("/") || value.includes("\\")) return resolve(value);
  for (const directory of String(process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, value);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return value;
}

function newestMtime(path) {
  let newest = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(target));
    else newest = Math.max(newest, statSync(target).mtimeMs);
  }
  return newest;
}

function validateConfig(config) {
  const currentNode = process.versions.node.split(".").map(Number);
  const supportedNode = MIN_NODE_VERSION.every((part, index) =>
    currentNode[index] === part || currentNode[index] > part || currentNode.slice(0, index).some((value, prior) => value > MIN_NODE_VERSION[prior]));
  if (!supportedNode) {
    throw new Error(`pi-lot-ui requires Node.js >= ${MIN_NODE_VERSION.join(".")} for its application database; current runtime is ${process.versions.node}`);
  }
  if (!config.PI_UI_DB_PATH.endsWith(".sqlite")) {
    throw new Error(`PI_UI_DB_PATH must name a .sqlite file: ${config.PI_UI_DB_PATH}`);
  }
  if (config.SQLITE_PATH && config.PI_UI_DB_PATH === config.SQLITE_PATH) {
    throw new Error("PI_UI_DB_PATH must be separate from the coding-agent sessions database");
  }
  if (!new Set(["jsonl", "sqlite"]).has(config.PERSISTENT_STORE)) {
    throw new Error(`Invalid PERSISTENT_STORE value "${config.PERSISTENT_STORE}"; expected "jsonl" or "sqlite"`);
  }
  try {
    accessSync(config.PI_BIN, constants.X_OK);
  } catch {
    throw new Error(`pi executable is missing or not executable: ${config.PI_BIN}. Build /home/ubuntu/pi-coding-agent or set PI_BIN/--pi explicitly.`);
  }
  if (config.PI_BIN === DEFAULT_LOCAL_PI) {
    const sourceRoot = resolve(dirname(config.PI_BIN), "..", "src");
    if (!existsSync(sourceRoot)) throw new Error(`local pi source is missing: ${sourceRoot}`);
    if (newestMtime(sourceRoot) > statSync(config.PI_BIN).mtimeMs) {
      throw new Error(`local pi build is stale: ${config.PI_BIN}. Run npm run build in /home/ubuntu/pi-coding-agent.`);
    }
  }
}

const piExtraArgs = (argValue("--pi-args") ?? process.env.PI_ARGS ?? "").split(" ").filter(Boolean);
const sessionDirIndex = piExtraArgs.indexOf("--session-dir");
const agentDir = resolve(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
const persistentStore = String(process.env.PERSISTENT_STORE ?? "sqlite").trim().toLowerCase();
const config = {
  PORT: Number(argValue("--port") ?? process.env.PORT ?? 8080),
  HOST: argValue("--host") ?? process.env.HOST ?? "0.0.0.0",
  PI_BIN: resolveExecutable(argValue("--pi") ?? process.env.PI_BIN ?? DEFAULT_LOCAL_PI),
  PI_DIR: resolve(argValue("--dir") ?? process.env.PI_DIR ?? process.cwd()),
  PI_EXTRA_ARGS: piExtraArgs,
  PERSISTENT_STORE: persistentStore,
  PI_AGENT_DIR: agentDir,
  PI_UI_DB_PATH: resolve(process.env.PI_UI_DB_PATH ?? join(homedir(), ".pi", "agent", "pi-lot-ui.sqlite")),
  SQLITE_PATH: persistentStore === "sqlite"
    ? join(resolve(sessionDirIndex >= 0 && piExtraArgs[sessionDirIndex + 1] ? piExtraArgs[sessionDirIndex + 1] : agentDir), "sessions.sqlite")
    : null,
  TOKEN: argValue("--token") ?? process.env.PI_UI_TOKEN ?? defaultToken(),
  TUNNEL_BIN: argValue("--tunnel-bin") ?? process.env.TUNNEL_BIN ?? defaultTunnelBin(),
  DIRNAME: __dirname,
};
validateConfig(config);
// Child processes inherit the single validated selection, including when the
// server supplied the SQLite default rather than receiving it from its parent.
process.env.PERSISTENT_STORE = config.PERSISTENT_STORE;

if (process.argv.includes("--check-config")) {
  console.log(JSON.stringify({
    piBin: config.PI_BIN,
    persistentStore: config.PERSISTENT_STORE,
    sqlitePath: config.SQLITE_PATH,
    appDbPath: config.PI_UI_DB_PATH,
    node: process.versions.node,
  }));
  process.exit(0);
}

// ---------------------------------------------------------------- shared state
// Everything the hot-reloaded module needs to persist across reloads.

// Open exactly once in the stable core. Hot-reloaded app modules receive this
// same service through state rather than creating their own connections.
const appStore = openAppStore({ databasePath: config.PI_UI_DB_PATH });
const recoveredOperationCount = appStore.reconcileInterruptedOperations();
const appHydration = appStore.hydrate();

const state = {
  config,
  appStore,
  /** Rebuildable caches hydrated without starting any OS process. */
  appSettings: new Map(appHydration.settings.map((entry) => [entry.key, entry])),
  incompleteOperations: new Map(appHydration.incompleteOperations.map((entry) => [entry.id, entry])),
  recoveredOperationCount,
  /** cwd for the pi process (changed via POST /workdir) */
  currentDir: config.PI_DIR,
  /** @type {Map<string, object>} live tunnels (id -> entry with proc handle) */
  tunnels: new Map(),
  /** @type {Set<http.ServerResponse>} open SSE responses */
  sseClients: new Set(),
  /** how many times app.mjs has been (re)loaded */
  reloadCount: 0,
  /** broadcast lives in the core so closures created by OLD versions of
   *  app.mjs (e.g. pi stdout listeners) keep working after a reload.
   *  Global server events are NOT buffered/replayed: reconnecting clients
   *  rebuild state from replay_done + the GET endpoints, and replaying
   *  stale one-shot events (toasts etc.) would be wrong. Per-runner output
   *  replay lives in runners.mjs (runner.buffer). */
  broadcast(line) {
    for (const res of state.sseClients) {
      if (!res.writableEnded && !res.destroyed) res.write(`data: ${line}\n\n`);
    }
  },
  serverEvent(obj) {
    state.broadcast(JSON.stringify({ ...obj, _server: true }));
  },
};

// ---------------------------------------------------------------- hot reload

const APP_PATH = join(__dirname, "app.mjs");

/** current request handler; swapped atomically on reload */
let app = null;

async function loadApp() {
  const url = `${pathToFileURL(APP_PATH)}?v=${statSync(APP_PATH).mtimeMs}`;
  const mod = await import(url);
  const next = await mod.init(state); // { handleRequest }
  app = next;
  state.reloadCount++;
  console.log(`[pi-ui] app.mjs loaded (reload #${state.reloadCount})`);
  if (state.reloadCount > 1) {
    state.serverEvent({ type: "code_reloaded", reloadCount: state.reloadCount });
  }
}

let reloadTimer = null;
function watchApp() {
  // Watch DIRECTORIES, not files: editors and tools often save via
  // write-to-temp + rename, which replaces the inode and permanently
  // detaches a file-based fs.watch. Directory watchers survive renames.
  const scheduleReload = (changed) => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      try {
        await loadApp();
        console.log(`[pi-ui] hot-reloaded app.mjs after ${changed} (clients stay connected: ${state.sseClients.size})`);
      } catch (e) {
        // keep serving with the previous version on syntax/runtime errors
        console.error(`[pi-ui] reload FAILED, keeping old code: ${e.message}`);
        state.serverEvent({ type: "code_reload_failed", error: e.message });
      }
    }, 150);
  };

  watch(__dirname, (_event, filename) => {
    if (filename === "app.mjs") scheduleReload("app.mjs");
  });

  const httpDir = join(__dirname, "http");
  const routeDir = join(httpDir, "routes");
  for (const directory of [httpDir, routeDir]) {
    if (!existsSync(directory)) continue;
    watch(directory, (_event, filename) => {
      if (filename?.endsWith(".mjs")) scheduleReload(`http/${directory === routeDir ? "routes/" : ""}${filename}`);
    });
  }

  // notify browsers when the Vite UI changes so they can refresh themselves
  const publicDir = join(__dirname, "public");
  const srcDir = join(publicDir, "src");
  if (existsSync(publicDir)) {
    let uiTimer = null;
    const notifyUiChanged = (label) => {
      clearTimeout(uiTimer);
      uiTimer = setTimeout(() => {
        console.log(`[pi-ui] ${label} changed, notifying browsers`);
        state.serverEvent({ type: "ui_reload" });
      }, 150);
    };
    watch(publicDir, (_event, filename) => {
      if (filename === "index.html") notifyUiChanged("public/index.html");
    });
    if (existsSync(srcDir)) {
      watch(srcDir, (_event, filename) => {
        if (filename) notifyUiChanged(`public/src/${filename}`);
      });
    }
  }
}

// ---------------------------------------------------------------- server

const server = http.createServer((req, res) => {
  // delegate to whatever version of app.mjs is current
  app.handleRequest(req, res).catch((e) => {
    console.error(`[pi-ui] handler error: ${e.stack ?? e}`);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
    }
    if (!res.writableEnded) res.end(JSON.stringify({ error: "internal error" }));
  });
});

await loadApp();
watchApp();

server.listen(config.PORT, config.HOST, () => {
  console.log(`[pi-ui] listening on http://${config.HOST}:${config.PORT}`);
  console.log(`[pi-ui] pi executable: ${config.PI_BIN}`);
  console.log(`[pi-ui] session backend: ${config.PERSISTENT_STORE}`);
  if (config.SQLITE_PATH) console.log(`[pi-ui] SQLite database: ${config.SQLITE_PATH}`);
  console.log(`[pi-ui] application database: ${state.appStore.path} (schema v${state.appStore.migrationStatus.currentVersion})`);
  console.log(`[pi-ui] pi working directory: ${config.PI_DIR}`);
  console.log(`[pi-ui] auth token: ${config.TOKEN}`);
  console.log(`[pi-ui] open: http://localhost:${config.PORT}/#token=${config.TOKEN}`);
  console.log(`[pi-ui] hot reload: watching app.mjs, http/, public/index.html + public/src`);
  app.startPi();
});

let shutdownPromise = null;
function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    server.close();
    const cleanup = Promise.allSettled([
      Promise.resolve().then(() => app.stopTunnels?.()),
      Promise.resolve().then(() => app.stopRoutines?.()),
      Promise.resolve().then(() => app.stopPi()),
    ]);
    const timeout = new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5000));
    await Promise.race([cleanup, timeout]);
    state.appStore.flush();
    state.appStore.close();
    process.exit(0);
  })().catch((error) => {
    console.error(`[pi-ui] shutdown failed: ${error.stack ?? error}`);
    try { state.appStore.close(); } catch {}
    process.exit(1);
  });
  return shutdownPromise;
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
