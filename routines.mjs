/**
 * pi-remote-ui — routine manager
 *
 * A "routine" is a runnable script living in the GLOBAL store
 * `~/.pi/routines/` (any executable file). Routines are *bound to the
 * session using them*: starting one from a session binds it to that
 * session's id (persisted in `~/.pi/routines/bindings.json`, along with the
 * working directory the run happened in, so teardown finds the byproducts
 * even after a server restart). Unbound routines are visible to every
 * session until someone starts them; deleting a session releases (and stops)
 * its routines.
 *
 * The server drives a routine through a tiny protocol:
 *
 *   <script> run       – started when the user hits ▶ (the main job)
 *   <script> teardown  – started when the user hits 🧹 (remove byproducts)
 *
 * Both run with cwd = the workdir of the session that bound the routine.
 * While running, the script can emit *progression notifications* on stdout:
 *
 *   ::progress 42 building assets      -> progress = 42%, message updated
 *   ::progress installing deps         -> message only (percent unknown)
 *
 * Every other stdout/stderr line goes into a capped log tail. Stop kills the
 * script's whole process group (SIGTERM, then SIGKILL).
 *
 * Live state is kept in `state.routines` (a Map owned by the stable core's
 * state object, keyed by script name) so it survives hot reloads of app.mjs.
 * Each value:
 *   {
 *     name:       string  – file name ("build.sh")
 *     path:       string  – absolute script path (~/.pi/routines/<name>)
 *     sessionId:  string|null – session this routine is bound to
 *     cwd:        string|null – where run/teardown execute (binder's workdir)
 *     status:     "idle" | "running" | "stopping" | "teardown" |
 *                 "done" | "stopped" | "failed"
 *     progress:   number|null  – 0..100 (from ::progress lines)
 *     message:    string|null  – last progress message
 *     startedAt / finishedAt: ISO timestamps of the last run
 *     exitCode:   number|null  – of the last finished run
 *     log:        string[]     – tail of non-progress output
 *     proc:       ChildProcess|null (never serialized to clients)
 *   }
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const ROUTINES_DIR = join(homedir(), ".pi", "routines");
const BINDINGS_PATH = join(ROUTINES_DIR, "bindings.json");
const LOG_MAX = 80;
const PROGRESS_RE = /^::progress\s+(?:(\d{1,3})%?(?:\s+|$))?(.*)$/;

export function routinesDir() {
  return ROUTINES_DIR;
}

/** Client-safe view of a routine (no process handle). */
export function routineInfo(r) {
  const { proc, ...info } = r;
  return { ...info, alive: !!proc };
}

function routinesMap(state) {
  if (!state.routines) state.routines = new Map();
  return state.routines;
}

function emit(state, r, reason) {
  state.serverEvent({ type: "routine_update", reason, routine: routineInfo(r) });
}

// ---- session bindings, persisted so teardown works across server restarts

function loadBindings() {
  try { return JSON.parse(readFileSync(BINDINGS_PATH, "utf8")); } catch { return {}; }
}

function saveBinding(r) {
  const bindings = loadBindings();
  if (r.sessionId || r.cwd) bindings[r.name] = { sessionId: r.sessionId ?? null, cwd: r.cwd ?? null };
  else delete bindings[r.name];
  try {
    mkdirSync(ROUTINES_DIR, { recursive: true });
    writeFileSync(BINDINGS_PATH, JSON.stringify(bindings, null, 2));
  } catch (e) {
    console.error(`[pi-ui] failed to save routine bindings: ${e.message}`);
  }
}

/** Scan ~/.pi/routines/ and merge with live state + persisted bindings. */
export function listRoutines(state) {
  const map = routinesMap(state);
  try { mkdirSync(ROUTINES_DIR, { recursive: true }); } catch {}
  const bindings = loadBindings();
  const found = new Set();
  for (const e of readdirSync(ROUTINES_DIR, { withFileTypes: true })) {
    if (!e.isFile() && !e.isSymbolicLink()) continue;
    const path = join(ROUTINES_DIR, e.name);
    let st;
    try { st = statSync(path); } catch { continue; }
    if (!st.isFile() || !(st.mode & 0o111)) continue; // executables only
    found.add(e.name);
    if (!map.has(e.name)) {
      map.set(e.name, {
        name: e.name, path,
        sessionId: bindings[e.name]?.sessionId ?? null,
        cwd: bindings[e.name]?.cwd ?? null,
        status: "idle", progress: null, message: null,
        startedAt: null, finishedAt: null, exitCode: null,
        log: [], proc: null,
      });
    }
  }
  // forget entries whose script vanished (or that pre-date the global store)
  // — unless they are still running (keep those visible so they can be stopped)
  for (const [key, r] of map) {
    if (!found.has(key) && !r.proc) map.delete(key);
  }
  return [...map.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(routineInfo);
}

function findRoutine(state, name) {
  listRoutines(state); // refresh entries from disk
  return routinesMap(state).get(name) ?? null;
}

function runScript(state, r, mode) {
  const cwd = r.cwd && existsSync(r.cwd) ? r.cwd : state.currentDir;
  const proc = spawn(r.path, [mode], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group, so stop can kill children too
  });
  r.proc = proc;
  r.status = mode === "run" ? "running" : "teardown";
  r.progress = mode === "run" ? 0 : null;
  r.message = null;
  r.startedAt = new Date().toISOString();
  r.finishedAt = null;
  r.exitCode = null;
  r.log = [];
  console.log(`[pi-ui] routine ${mode}: ${r.path} (pid ${proc.pid}, cwd ${cwd}, session ${r.sessionId ?? "-"})`);
  emit(state, r, mode === "run" ? "started" : "teardown_started");

  const onLine = (line) => {
    line = line.trimEnd();
    if (!line) return;
    const m = line.match(PROGRESS_RE);
    if (m) {
      if (m[1] !== undefined) r.progress = Math.min(100, Number(m[1]));
      if (m[2]) r.message = m[2];
      emit(state, r, "progress");
      return;
    }
    r.log.push(line);
    if (r.log.length > LOG_MAX) r.log.shift();
    emit(state, r, "output");
  };
  createInterface({ input: proc.stdout }).on("line", onLine);
  createInterface({ input: proc.stderr }).on("line", onLine);

  proc.on("error", (err) => {
    if (r.proc !== proc) return;
    r.proc = null;
    r.status = "failed";
    r.message = err.message;
    r.finishedAt = new Date().toISOString();
    emit(state, r, "error");
  });

  proc.on("exit", (code, signal) => {
    if (r.proc !== proc) return;
    r.proc = null;
    r.exitCode = code;
    r.finishedAt = new Date().toISOString();
    console.log(`[pi-ui] routine ${r.name} ${mode} exited (code=${code}, signal=${signal})`);
    if (mode === "teardown") {
      r.status = code === 0 ? "idle" : "failed";
      r.progress = null;
      r.message = code === 0 ? "byproducts removed" : (r.message ?? `teardown failed (exit ${code})`);
      emit(state, r, "teardown_finished");
    } else if (r.status === "stopping") {
      r.status = "stopped";
      emit(state, r, "stopped");
    } else {
      r.status = code === 0 ? "done" : "failed";
      if (code === 0 && r.progress !== null) r.progress = 100;
      emit(state, r, "finished");
    }
  });
}

/** Start a routine's `run`. Binds it to the calling session (and its
 *  workdir); the binding persists until the session releases it. */
export function startRoutine(state, name, { sessionId = null, cwd = null } = {}) {
  const r = findRoutine(state, name);
  if (!r) throw new Error(`no such routine: ${name}`);
  if (r.proc) throw new Error(`routine "${name}" is already ${r.status}`);
  if (r.sessionId && sessionId && r.sessionId !== sessionId) {
    throw new Error(`routine "${name}" is bound to another session — release it there first`);
  }
  if (sessionId) r.sessionId = sessionId;
  if (cwd) r.cwd = cwd;
  saveBinding(r);
  runScript(state, r, "run");
  return routineInfo(r);
}

export function stopRoutine(state, name) {
  const r = findRoutine(state, name);
  if (!r) throw new Error(`no such routine: ${name}`);
  if (!r.proc) throw new Error(`routine "${name}" is not running`);
  r.status = "stopping";
  emit(state, r, "stopping");
  const pid = r.proc.pid;
  try { process.kill(-pid, "SIGTERM"); } catch { try { r.proc.kill("SIGTERM"); } catch {} }
  setTimeout(() => { try { process.kill(-pid, "SIGKILL"); } catch {} }, 4000).unref();
  return routineInfo(r);
}

/** Run the routine's `teardown` in the cwd of its last run (persisted). */
export function teardownRoutine(state, name) {
  const r = findRoutine(state, name);
  if (!r) throw new Error(`no such routine: ${name}`);
  if (r.proc) throw new Error(`routine "${name}" is ${r.status} — stop it first`);
  runScript(state, r, "teardown");
  return routineInfo(r);
}

/** Release one routine's session binding (does not touch byproducts). */
export function releaseRoutine(state, name) {
  const r = findRoutine(state, name);
  if (!r) throw new Error(`no such routine: ${name}`);
  if (r.proc) throw new Error(`routine "${name}" is ${r.status} — stop it first`);
  r.sessionId = null;
  r.cwd = null;
  saveBinding(r);
  emit(state, r, "released");
  return routineInfo(r);
}

/** Release every routine bound to a session (e.g. when it is deleted):
 *  stops running ones and removes the binding. Returns the released names. */
export function releaseSessionRoutines(state, sessionId) {
  if (!sessionId) return [];
  listRoutines(state); // make sure persisted bindings are materialized
  const released = [];
  for (const r of routinesMap(state).values()) {
    if (r.sessionId !== sessionId) continue;
    if (r.proc) { try { stopRoutine(state, r.name); } catch {} }
    r.sessionId = null;
    r.cwd = null;
    saveBinding(r);
    released.push(r.name);
    emit(state, r, "released");
  }
  return released;
}

/** Kill every running routine (server shutdown). */
export function stopAllRoutines(state) {
  for (const r of state.routines?.values() ?? []) {
    if (!r.proc) continue;
    try { process.kill(-r.proc.pid, "SIGKILL"); } catch { try { r.proc.kill("SIGKILL"); } catch {} }
  }
}
