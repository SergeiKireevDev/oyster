#!/usr/bin/env node
/**
 * oyster — stable core (hot-reload host)
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
import {
  accessSync, closeSync, constants, existsSync, fsyncSync, openSync,
  readFileSync, readdirSync, statSync, unlinkSync, watch, writeFileSync,
} from "node:fs";
import http from "node:http";
import { delimiter, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openAppStore } from "./persistence/appStore.mjs";
import { createAppSettings } from "./persistence/appSettings.mjs";
import { assertStableStateInventory, createStableEphemeralState } from "./persistence/stateInventory.mjs";
import { RELOADABLE_SERVER_MODULES } from "./reload-manifest.mjs";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SERVER_DIR, "..");

// ---------------------------------------------------------------- config

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function envFlag(name) {
  const value = process.env[name];
  if (value == null || value === "") return false;
  if (["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(String(value).trim().toLowerCase())) return false;
  throw new Error(`${name} must be one of: 1, true, yes, on, 0, false, no, off`);
}

function defaultToken() {
  const tokenFile = join(PROJECT_ROOT, ".ui-token");
  const readStoredToken = () => {
    try {
      const token = readFileSync(tokenFile, "utf8").trim();
      if (!token) throw new Error(`Oyster token file is empty: ${tokenFile}`);
      return token;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    const stored = readStoredToken();
    if (stored) return stored;

    const generated = randomBytes(16).toString("hex");
    let descriptor = null;
    let created = false;
    try {
      descriptor = openSync(tokenFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      created = true;
      writeFileSync(descriptor, `${generated}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;
      return generated;
    } catch (error) {
      if (descriptor !== null) try { closeSync(descriptor); } catch {}
      if (created) try { unlinkSync(tokenFile); } catch {}
      // Another server may have created and then removed the file. Retry the
      // complete atomic read/create sequence rather than returning null.
      if (error.code === "EEXIST") {
        const racedToken = readStoredToken();
        if (racedToken) return racedToken;
        if (attempt < 3) continue;
      }
      throw new Error(`cannot persist generated Oyster token at ${tokenFile}: ${error.message}`, { cause: error });
    }
  }
  throw new Error(`cannot persist generated Oyster token at ${tokenFile}`);
}

function defaultTunnelBin() {
  // prefer a user-local install when cloudflared is not on the server's PATH
  const local = join(homedir(), ".local", "bin", "cloudflared");
  return existsSync(local) ? local : "cloudflared";
}

const DEFAULT_LOCAL_PI = join(PROJECT_ROOT, "pi", "packages", "coding-agent", "dist", "cli.js");
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

function detectExecutable(value) {
  const resolved = resolveExecutable(value);
  try { accessSync(resolved, constants.X_OK); return resolved; }
  catch { return null; }
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
    throw new Error(`oyster requires Node.js >= ${MIN_NODE_VERSION.join(".")} for its application database; current runtime is ${process.versions.node}`);
  }
  if (!Number.isInteger(config.PORT) || config.PORT < 0 || config.PORT > 65535) {
    throw new Error("PORT/--port must be an integer from 0 to 65535");
  }
  if (typeof config.HOST !== "string" || config.HOST.trim() === "") {
    throw new Error("HOST/--host must not be empty");
  }
  try {
    if (!statSync(config.PI_DIR).isDirectory()) throw new Error("not a directory");
    accessSync(config.PI_DIR, constants.R_OK | constants.X_OK);
  } catch (error) {
    throw new Error(`PI_DIR/--dir must be an accessible directory: ${config.PI_DIR} (${error.message})`);
  }
  if (typeof config.TOKEN !== "string" || config.TOKEN.trim() === "" || /[\u0000-\u001f\u007f]/.test(config.TOKEN)) {
    throw new Error("OYSTER_TOKEN/--token must be a non-empty string without control characters");
  }
  const configuredSessionDir = config.PI_EXTRA_ARGS.indexOf("--session-dir");
  if (configuredSessionDir >= 0 && !config.PI_EXTRA_ARGS[configuredSessionDir + 1]) {
    throw new Error("--session-dir in PI_ARGS/--pi-args requires a directory");
  }
  if (!config.OYSTER_DB_PATH.endsWith(".sqlite")) {
    throw new Error(`OYSTER_DB_PATH must name a .sqlite file: ${config.OYSTER_DB_PATH}`);
  }
  if (config.SQLITE_PATH && config.OYSTER_DB_PATH === config.SQLITE_PATH) {
    throw new Error("OYSTER_DB_PATH must be separate from the coding-agent sessions database");
  }
  if (!new Set(["jsonl", "sqlite"]).has(config.PERSISTENT_STORE)) {
    throw new Error(`Invalid PERSISTENT_STORE value "${config.PERSISTENT_STORE}"; expected "jsonl" or "sqlite"`);
  }
  if (!Number.isInteger(config.HUBLOT_TUNNEL_POOL_SIZE) || config.HUBLOT_TUNNEL_POOL_SIZE < 0 || config.HUBLOT_TUNNEL_POOL_SIZE > 16) {
    throw new Error("OYSTER_HUBLOT_TUNNEL_POOL_SIZE must be an integer from 0 to 16");
  }
  try {
    accessSync(config.PI_BIN, constants.X_OK);
  } catch {
    throw new Error(`pi executable is missing or not executable: ${config.PI_BIN}. Initialize and build the pi submodule or set PI_BIN/--pi explicitly.`);
  }
  if (config.CLAUDE_CODE_BIN) {
    try { accessSync(config.CLAUDE_CODE_BIN, constants.X_OK); }
    catch { throw new Error(`Claude Code executable is missing or not executable: ${config.CLAUDE_CODE_BIN}`); }
  }
  if (config.PI_BIN === DEFAULT_LOCAL_PI) {
    const sourceRoot = resolve(dirname(config.PI_BIN), "..", "src");
    if (!existsSync(sourceRoot)) throw new Error(`local pi source is missing: ${sourceRoot}`);
    if (newestMtime(sourceRoot) > statSync(config.PI_BIN).mtimeMs) {
      throw new Error(`local pi build is stale: ${config.PI_BIN}. Run npm run build:pi.`);
    }
  }
}

const piExtraArgs = (argValue("--pi-args") ?? process.env.PI_ARGS ?? "").split(" ").filter(Boolean);
const requestedClaudeCodeBin = argValue("--claude-code") ?? process.env.CLAUDE_CODE_BIN ?? null;
const claudeCodeBin = requestedClaudeCodeBin ? resolveExecutable(requestedClaudeCodeBin) : detectExecutable("claude");
const claudeCodeArgs = (process.env.CLAUDE_CODE_ARGS ?? "").split(" ").filter(Boolean);
const sessionDirIndex = piExtraArgs.indexOf("--session-dir");
const agentDir = resolve(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
const persistentStore = String(process.env.PERSISTENT_STORE ?? "sqlite").trim().toLowerCase();
const config = Object.freeze({
  PORT: Number(argValue("--port") ?? process.env.PORT ?? 8080),
  HOST: argValue("--host") ?? process.env.HOST ?? "0.0.0.0",
  PI_BIN: resolveExecutable(argValue("--pi") ?? process.env.PI_BIN ?? DEFAULT_LOCAL_PI),
  PI_DIR: resolve(argValue("--dir") ?? process.env.PI_DIR ?? process.cwd()),
  PI_EXTRA_ARGS: Object.freeze(piExtraArgs),
  CLAUDE_CODE_BIN: claudeCodeBin ? resolveExecutable(claudeCodeBin) : null,
  CLAUDE_CODE_ARGS: Object.freeze(claudeCodeArgs),
  CLAUDE_CODE_PERMISSION_MODE: process.env.CLAUDE_CODE_PERMISSION_MODE ?? "acceptEdits",
  CLAUDE_CODE_PROJECTS_DIR: resolve(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects"),
  PERSISTENT_STORE: persistentStore,
  PI_AGENT_DIR: agentDir,
  OYSTER_DB_PATH: resolve(process.env.OYSTER_DB_PATH ?? join(homedir(), ".pi", "agent", "oyster.sqlite")),
  SQLITE_PATH: persistentStore === "sqlite"
    ? join(resolve(sessionDirIndex >= 0 && piExtraArgs[sessionDirIndex + 1] ? piExtraArgs[sessionDirIndex + 1] : agentDir), "sessions.sqlite")
    : null,
  TOKEN: argValue("--token") ?? process.env.OYSTER_TOKEN ?? defaultToken(),
  UNAUTHENTICATED: process.argv.includes("--unauthenticated") || envFlag("OYSTER_UNAUTHENTICATED"),
  TUNNEL_BIN: argValue("--tunnel-bin") ?? process.env.TUNNEL_BIN ?? defaultTunnelBin(),
  HUBLOT_TUNNEL_POOL_SIZE: Number(process.env.OYSTER_HUBLOT_TUNNEL_POOL_SIZE ?? 2),
  SKIP_PUBLIC_HUBLOT_READINESS: envFlag("OYSTER_SKIP_PUBLIC_HUBLOT_READINESS"),
  DIRNAME: PROJECT_ROOT,
});
validateConfig(config);
// Child processes inherit the single validated selection, including when the
// server supplied the SQLite default rather than receiving it from its parent.
process.env.PERSISTENT_STORE = config.PERSISTENT_STORE;

if (process.argv.includes("--check-config")) {
  console.log(JSON.stringify({
    piBin: config.PI_BIN,
    claudeCodeBin: config.CLAUDE_CODE_BIN,
    claudeCodeProjectsDir: config.CLAUDE_CODE_PROJECTS_DIR,
    persistentStore: config.PERSISTENT_STORE,
    sqlitePath: config.SQLITE_PATH,
    appDbPath: config.OYSTER_DB_PATH,
    unauthenticated: config.UNAUTHENTICATED,
    hublotTunnelPoolSize: config.HUBLOT_TUNNEL_POOL_SIZE,
    node: process.versions.node,
  }));
  process.exit(0);
}

// ---------------------------------------------------------------- shared state
// Everything the hot-reloaded module needs to persist across reloads.

// Open exactly once in the stable core. Hot-reloaded app modules receive this
// same service through state rather than creating their own connections.
const appStore = await openAppStore({ databasePath: config.OYSTER_DB_PATH });
const recoveredOperationCount = await appStore.reconcileInterruptedOperations();
const interruptedRoutineRunCount = await appStore.reconcileInterruptedRoutineRuns();
const appHydration = await appStore.hydrate();
const appSettings = createAppSettings({ repository: appStore.repositories.settings, startupWorkdir: config.PI_DIR });
const hydratedSettings = await appSettings.hydrate();
let currentWorkdir = hydratedSettings.currentWorkdir;
try {
  if (!statSync(currentWorkdir).isDirectory()) throw new Error("not a directory");
  accessSync(currentWorkdir, constants.R_OK | constants.X_OK);
} catch (error) {
  console.warn(`[oyster] persisted workdir is unavailable; falling back to ${config.PI_DIR}: ${error.message}`);
  currentWorkdir = config.PI_DIR;
  await appSettings.setCurrentWorkdir(currentWorkdir);
}

const state = {
  config,
  appStore,
  /** Rebuildable caches hydrated without starting any OS process. */
  appSettings,
  incompleteOperations: new Map(appHydration.incompleteOperations.map((entry) => [entry.id, entry])),
  recoveredOperationCount,
  /** cwd for the pi process (changed via POST /workdir) */
  // Persisted mutable settings override startup defaults when valid.
  currentDir: currentWorkdir,
  defaultRunnerId: hydratedSettings.defaultRunnerId,
  // Fresh per-process handles, connections, throttle buckets, and counters.
  ...createStableEphemeralState(),
  /** broadcast lives in the core so closures created by OLD versions of
   *  app.mjs (e.g. pi stdout listeners) keep working after a reload.
   *  Global server events are NOT buffered/replayed: reconnecting clients
   *  rebuild state from replay_done + the GET endpoints, and replaying
   *  stale one-shot events (toasts etc.) would be wrong. Per-runner output
   *  replay lives in the runner_events repository. */
  broadcast(line) {
    for (const res of state.sseClients) {
      if (res.writableEnded || res.destroyed) {
        state.sseClients.delete(res);
        continue;
      }
      try {
        res.write(`data: ${line}\n\n`);
      } catch (error) {
        state.sseClients.delete(res);
        console.error(`[oyster] SSE broadcast failed: ${error.message ?? error}`);
        res.destroy();
      }
    }
  },
  serverEvent(obj) {
    state.broadcast(JSON.stringify({ ...obj, _server: true }));
  },
};
assertStableStateInventory(state);

// ---------------------------------------------------------------- hot reload

const APP_PATH = join(SERVER_DIR, "app.mjs");

/** current request handler; swapped atomically on reload */
let app = null;

const RETIREMENT_MAX_ATTEMPTS = 3;
const RETIREMENT_RETRY_DELAY_MS = 100;

async function retireApplication(application, retiredReloadCount) {
  for (let attempt = 1; attempt <= RETIREMENT_MAX_ATTEMPTS; attempt++) {
    try {
      await application.dispose();
      if (attempt > 1) console.log(`[oyster] retired application cleanup recovered on attempt ${attempt}`);
      return;
    } catch (error) {
      const willRetry = attempt < RETIREMENT_MAX_ATTEMPTS;
      console.error(`[oyster] retired application cleanup failed (attempt ${attempt}/${RETIREMENT_MAX_ATTEMPTS}): ${error.message}`);
      // SSE registration is behind the application's authenticated route. Do
      // not put cleanup details on the unauthenticated health endpoint.
      state.serverEvent({
        type: "code_reload_cleanup_failed",
        committed: true,
        reloadCount: retiredReloadCount,
        attempt,
        maxAttempts: RETIREMENT_MAX_ATTEMPTS,
        willRetry,
        error: error.message,
      });
      if (!willRetry) {
        console.error(`[oyster] retired application cleanup abandoned after ${RETIREMENT_MAX_ATTEMPTS} attempts; the new application remains active`);
        return;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, RETIREMENT_RETRY_DELAY_MS));
    }
  }
}

let nextApplicationGeneration = 0;

async function loadApp() {
  // Allocate before import so failed attempts cannot reuse a generation token.
  const generation = ++nextApplicationGeneration;
  const url = `${pathToFileURL(APP_PATH)}?generation=${generation}&mtime=${statSync(APP_PATH).mtimeMs}`;
  const mod = await import(url);
  const transactional = typeof mod.buildCandidate === "function";
  if (!transactional && typeof mod.init !== "function") {
    throw new Error("application module must export buildCandidate() or init()");
  }
  let candidate = null;
  try {
    // init() remains supported for small embedders and older application
    // modules. Transactional applications expose buildCandidate().
    candidate = transactional
      ? await mod.buildCandidate(state, { generation })
      : await mod.init(state);
    if (!candidate || typeof candidate.handleRequest !== "function") {
      throw new Error("candidate application is missing handleRequest()");
    }
    if (transactional && typeof candidate.dispose !== "function") {
      throw new Error("candidate application is missing dispose()");
    }
    if (shuttingDown) throw new Error("application load cancelled during shutdown");
    if (typeof candidate.activate === "function") await candidate.activate();
    if (shuttingDown) throw new Error("application load cancelled during shutdown");
    // Transactional candidates may expose lifecycle methods through getters
    // that become available only after activation has assembled the app.
    if (typeof candidate.startPi !== "function" || typeof candidate.stopPi !== "function") {
      throw new Error("candidate application is missing startPi() or stopPi()");
    }
  } catch (error) {
    // Nothing active is touched before the single assignment below. A failed
    // activated candidate owns and cleans only its staged resources.
    if (typeof candidate?.dispose === "function") {
      try {
        await candidate.dispose();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "candidate activation and cleanup failed");
      }
    }
    throw error;
  }

  const previous = app;
  app = candidate; // commit point: synchronous, non-throwing handler swap
  state.reloadCount++;
  console.log(`[oyster] app.mjs loaded (reload #${state.reloadCount})`);
  if (state.reloadCount > 1) {
    state.serverEvent({ type: "code_reloaded", reloadCount: state.reloadCount });
  }

  // Retirement is deliberately post-commit. New requests can only enter the
  // candidate, while its dispose() drains requests already admitted by old.
  if (previous?.dispose) await retireApplication(previous, state.reloadCount);
}

let reloadTimer = null;
let reloadInProgress = false;
let activeReload = null;
let pendingReload = null;
let shuttingDown = false;
const fileWatchers = new Set();

function closeFileWatchers() {
  clearTimeout(reloadTimer);
  reloadTimer = null;
  pendingReload = null;
  for (const watcher of fileWatchers) {
    try { watcher.close(); } catch {}
  }
  fileWatchers.clear();
}

function watchDirectory(directory, listener) {
  const watcher = watch(directory, listener);
  watcher.on("error", (error) => {
    fileWatchers.delete(watcher);
    console.error(`[oyster] file watcher failed for ${directory}: ${error.message}`);
    state.serverEvent({ type: "code_reload_watch_failed", directory, error: error.message });
  });
  fileWatchers.add(watcher);
}

function drainReloads() {
  if (reloadInProgress || shuttingDown || !pendingReload) return activeReload;
  reloadInProgress = true;
  const changed = pendingReload;
  pendingReload = null;
  activeReload = (async () => {
    try {
      await loadApp();
      console.log(`[oyster] hot-reloaded app.mjs after ${changed} (clients stay connected: ${state.sseClients.size})`);
    } catch (error) {
      // Keep serving with the previous version on syntax/runtime errors.
      if (!shuttingDown) {
        console.error(`[oyster] reload FAILED, keeping old code: ${error.message}`);
        state.serverEvent({ type: "code_reload_failed", error: error.message });
      }
    } finally {
      reloadInProgress = false;
      activeReload = null;
      // A watcher timer may have fired while this reload was still active.
      // Re-arm it so that the newer change is neither lost nor loaded before
      // its debounce window has elapsed.
      if (pendingReload && !reloadTimer && !shuttingDown) {
        reloadTimer = setTimeout(() => {
          reloadTimer = null;
          void drainReloads();
        }, 150);
      }
    }
  })();
  return activeReload;
}

function watchApp() {
  // Watch DIRECTORIES, not files: editors and tools often save via
  // write-to-temp + rename, which replaces the inode and permanently
  // detaches a file-based fs.watch. Directory watchers survive renames.
  const scheduleReload = (changed) => {
    if (shuttingDown) return;
    pendingReload = changed;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      void drainReloads();
    }, 150);
  };

  // The manifest is the single claim about what can participate in a
  // transactional candidate. Watch each containing directory once and ignore
  // unrelated files instead of maintaining ad hoc watcher lists here.
  const reloadable = new Set(RELOADABLE_SERVER_MODULES);
  const reloadDirectories = new Set(RELOADABLE_SERVER_MODULES.map((module) => dirname(module)));
  for (const relativeDirectory of reloadDirectories) {
    const directory = relativeDirectory === "." ? SERVER_DIR : join(SERVER_DIR, relativeDirectory);
    if (!existsSync(directory)) continue;
    watchDirectory(directory, (_event, filename) => {
      if (!filename) return;
      const relativeModule = relativeDirectory === "." ? String(filename) : join(relativeDirectory, String(filename));
      if (reloadable.has(relativeModule)) scheduleReload(relativeModule);
    });
  }

  // Notify browsers only after Vite has emitted the UI they are actually
  // served. Watching public/ reloaded clients before dist/ had been rebuilt,
  // leaving them on stale hashed assets.
  const distDir = join(PROJECT_ROOT, "dist");
  const assetsDir = join(distDir, "assets");
  if (existsSync(distDir)) {
    let uiTimer = null;
    const notifyUiChanged = (label) => {
      if (shuttingDown) return;
      clearTimeout(uiTimer);
      uiTimer = setTimeout(() => {
        if (shuttingDown) return;
        console.log(`[oyster] ${label} changed, notifying browsers`);
        state.serverEvent({ type: "ui_reload" });
      }, 150);
    };
    for (const directory of [distDir, assetsDir]) {
      if (!existsSync(directory)) continue;
      watchDirectory(directory, (_event, filename) => {
        if (filename) notifyUiChanged(`dist/${directory === assetsDir ? "assets/" : ""}${filename}`);
      });
    }
  }
}

// ---------------------------------------------------------------- server

function handleRequestFailure(error, res) {
  console.error(`[oyster] handler error: ${error?.stack ?? error}`);
  if (res.destroyed || res.writableEnded) return;
  if (!res.headersSent) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal error" }));
    return;
  }
  // Once a streaming or partial response has started, appending JSON would
  // corrupt its protocol. Terminate the connection instead.
  res.destroy();
}

const server = http.createServer((req, res) => {
  // Read once: this request belongs entirely to the selected generation even
  // when a reload commits before its handler settles.
  const selectedApplication = app;
  try {
    Promise.resolve(selectedApplication.handleRequest(req, res)).catch((error) => {
      handleRequestFailure(error, res);
    });
  } catch (error) {
    handleRequestFailure(error, res);
  }
});

await loadApp();
watchApp();

server.listen(config.PORT, config.HOST, () => {
  console.log(`[oyster] listening on http://${config.HOST}:${config.PORT}`);
  console.log(`[oyster] pi executable: ${config.PI_BIN}`);
  console.log(`[oyster] session backend: ${config.PERSISTENT_STORE}`);
  if (config.SQLITE_PATH) console.log(`[oyster] SQLite database: ${config.SQLITE_PATH}`);
  console.log(`[oyster] application database: ${state.appStore.path} (schema v${state.appStore.migrationStatus.currentVersion})`);
  if (interruptedRoutineRunCount) console.log(`[oyster] reconciled ${interruptedRoutineRunCount} interrupted routine run(s)`);
  console.log(`[oyster] pi working directory: ${config.PI_DIR}`);
  if (config.UNAUTHENTICATED) {
    console.warn("[oyster] WARNING: authentication is DISABLED; every client that can reach Oyster has full workspace and agent access");
    console.log(`[oyster] open: http://localhost:${config.PORT}/`);
  } else {
    console.log(`[oyster] auth token: ${config.TOKEN}`);
    console.log(`[oyster] open: http://localhost:${config.PORT}/#token=${config.TOKEN}`);
  }
  console.log(`[oyster] hot reload: watching ${RELOADABLE_SERVER_MODULES.length} server modules and dist/`);
  app.startPi();
});

let shutdownPromise = null;
function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  closeFileWatchers();
  shutdownPromise = (async () => {
    server.close();
    if (activeReload) await activeReload;
    const shutdownApplication = app;
    for (const res of state.sseClients) res.end();
    state.sseClients.clear();

    // Hublot cleanup is internally bounded and must finish before the store closes;
    // its exit callbacks persist final process metadata needed for restart recovery.
    try {
      await Promise.resolve().then(() => shutdownApplication.stopTunnels?.());
    } catch (error) {
      console.error(`[oyster] tunnel shutdown failed: ${error.stack ?? error}`);
    }

    const cleanup = Promise.allSettled([
      Promise.resolve().then(() => shutdownApplication.stopRoutines?.()),
      Promise.resolve().then(() => shutdownApplication.stopOAuth?.()),
      Promise.resolve().then(() => shutdownApplication.stopPi()),
    ]);
    let timeoutHandle;
    const timeout = new Promise((resolveTimeout) => {
      timeoutHandle = setTimeout(() => resolveTimeout("timeout"), 5000);
    });
    const cleanupResult = await Promise.race([cleanup, timeout]);
    clearTimeout(timeoutHandle);
    if (cleanupResult === "timeout") {
      console.error("[oyster] application shutdown timed out after 5000ms");
    } else {
      for (const result of cleanupResult) {
        if (result.status === "rejected") console.error(`[oyster] application shutdown hook failed: ${result.reason?.stack ?? result.reason}`);
      }
    }
    server.closeAllConnections();
    await state.appStore.flush();
    await state.appStore.close();
    process.exit(0);
  })().catch(async (error) => {
    console.error(`[oyster] shutdown failed: ${error.stack ?? error}`);
    try { server.closeAllConnections(); } catch {}
    try { await state.appStore.close(); } catch {}
    process.exit(1);
  });
  return shutdownPromise;
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
