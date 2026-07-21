/**
 * pi-lot-ui — routine manager
 *
 * A routine definition and its optional session binding are authoritative in
 * the app SQLite store. Executable files under `~/.pi/routines/` are runtime
 * artifacts only. Unbound routines are visible to every session until bound.
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
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { materializeRoutineScript } from "./persistence/routineMaterializer.mjs";

const ROUTINES_DIR = join(homedir(), ".pi", "routines");
const LOG_MAX = 80;
const PROGRESS_RE = /^::progress\s+(?:(\d{1,3})%?(?:\s+|$))?(.*)$/;

function invalidateRoutinesCache() {}

export function routinesDir() {
  return ROUTINES_DIR;
}

/** Client-safe view of a routine (no process handle). */
export function routineInfo(r) {
  const { proc, executionPath: _executionPath, id: _id, revision: _revision, ...info } = r;
  return { ...info, alive: !!proc };
}

function routinesMap(state) {
  if (!state.routines) state.routines = new Map();
  return state.routines;
}

function emit(state, r, reason) {
  state.serverEvent({ type: "routine_update", reason, routine: routineInfo(r) });
}

function routineRepository(state) {
  const repository = state.appStore?.repositories?.routines;
  if (!repository) throw new Error("routine repository is required");
  return repository;
}

function mergeRoutineRow(state, row) {
  const map = routinesMap(state);
  const existing = map.get(row.name);
  const entry = existing ?? {
    id: row.id, name: row.name, path: join(ROUTINES_DIR, row.name),
    status: "idle", progress: null, message: null,
    startedAt: null, finishedAt: null, exitCode: null, log: [], proc: null,
  };
  entry.id = row.id;
  entry.sessionId = row.session_id ?? null;
  entry.cwd = row.cwd ?? null;
  entry.revision = row.revision;
  map.set(row.name, entry);
  return entry;
}

export function listRoutines(state) {
  const map = routinesMap(state);
  const rows = routineRepository(state).list();
  const names = new Set(rows.map((row) => row.name));
  for (const row of rows) mergeRoutineRow(state, row);
  for (const [name, routine] of map) if (!names.has(name) && !routine.proc) map.delete(name);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name)).map(routineInfo);
}

function findRoutine(state, name) {
  const row = routineRepository(state).findByName(name);
  return row ? mergeRoutineRow(state, row) : null;
}

function runScript(state, r, mode) {
  const cwd = r.cwd && existsSync(r.cwd) ? r.cwd : state.currentDir;
  const definition = routineRepository(state).findByName(r.name);
  if (!definition) throw new Error(`no such routine: ${r.name}`);
  const executionPath = materializeRoutineScript(definition);
  r.executionPath = executionPath;
  const proc = spawn(executionPath, [mode], {
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
  console.log(`[pi-ui] routine ${mode}: ${executionPath} (pid ${proc.pid}, cwd ${cwd}, session ${r.sessionId ?? "-"})`);
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

/** Create (or overwrite) a routine script in the global store and bind it
 *  to the calling session. The script must implement the routine protocol:
 *  `<script> run` and `<script> teardown`, with optional `::progress` lines. */
export function createRoutine(state, { name, script, sessionId = null, ownerId = null, cwd = null }) {
  if (!/^[A-Za-z0-9][\w.-]*$/.test(name)) throw new Error(`invalid routine name: ${name}`);
  if (sessionId && !ownerId) throw new Error("session owner is required to bind a routine");
  const map = routinesMap(state);
  invalidateRoutinesCache();
  const existing = findRoutine(state, name);
  if (existing?.proc) throw new Error(`routine "${name}" is currently ${existing.status} — stop it before overwriting`);
  if (existing?.sessionId && sessionId && existing.sessionId !== sessionId) {
    throw new Error(`routine "${name}" exists and is bound to another session`);
  }
  const path = join(ROUTINES_DIR, name);
  const row = routineRepository(state).upsert({
    id: existing?.id ?? randomUUID(), ownerId, name, script, cwd, now: new Date().toISOString(),
  });
  const r = mergeRoutineRow(state, row);
  map.set(name, r);
  invalidateRoutinesCache();
  console.log(`[pi-ui] routine ${existing ? "updated" : "created"}: ${path} (session ${r.sessionId ?? "-"})`);
  emit(state, r, existing ? "updated" : "created");
  return routineInfo(r);
}

/** Delete a routine's script and binding. Refuses while it is running;
 *  byproducts are NOT touched — run teardown first if needed. */
export function deleteRoutine(state, name) {
  const r = findRoutine(state, name);
  if (!r) throw new Error(`no such routine: ${name}`);
  if (r.proc) throw new Error(`routine "${name}" is ${r.status} — stop it first`);
  routineRepository(state).delete(r.id);
  for (const artifact of [r.path, r.executionPath]) {
    if (!artifact) continue;
    try { unlinkSync(artifact); } catch (e) { if (e.code !== "ENOENT") throw new Error(`failed to delete ${artifact}: ${e.message}`); }
  }
  r.sessionId = null;
  r.cwd = null;
  routinesMap(state).delete(name);
  invalidateRoutinesCache();
  emit(state, r, "deleted");
  return routineInfo(r);
}

/** Start a routine's `run`. Binds it to the calling session (and its
 *  workdir); the binding persists until the session releases it. */
export function startRoutine(state, name, { sessionId = null, ownerId = null, cwd = null } = {}) {
  const r = findRoutine(state, name);
  if (!r) throw new Error(`no such routine: ${name}`);
  if (r.proc) throw new Error(`routine "${name}" is already ${r.status}`);
  if (r.sessionId && sessionId && r.sessionId !== sessionId) {
    throw new Error(`routine "${name}" is bound to another session — release it there first`);
  }
  if (sessionId) {
    if (!ownerId) throw new Error("session owner is required to bind a routine");
    routineRepository(state).bind(r.id, ownerId, cwd, new Date().toISOString());
    r.sessionId = sessionId;
  }
  if (cwd) r.cwd = cwd;
  invalidateRoutinesCache();
  runScript(state, r, "run");
  return routineInfo(r);
}

export function stopRoutine(state, name) {
  const r = findRoutine(state, name);
  if (!r) throw new Error(`no such routine: ${name}`);
  if (!r.proc) throw new Error(`routine "${name}" is not running`);
  r.status = "stopping";
  invalidateRoutinesCache();
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
  invalidateRoutinesCache();
  runScript(state, r, "teardown");
  return routineInfo(r);
}

/** Release one routine's session binding (does not touch byproducts). */
export function releaseRoutine(state, name) {
  const r = findRoutine(state, name);
  if (!r) throw new Error(`no such routine: ${name}`);
  if (r.proc) throw new Error(`routine "${name}" is ${r.status} — stop it first`);
  routineRepository(state).release(r.id, new Date().toISOString());
  r.sessionId = null;
  r.cwd = null;
  invalidateRoutinesCache();
  emit(state, r, "released");
  return routineInfo(r);
}

/** Stop live routines before their owning session is deleted, retaining definitions. */
export function stopSessionRoutines(state, sessionId) {
  if (!sessionId) return [];
  listRoutines(state);
  const stopped = [];
  for (const r of routinesMap(state).values()) {
    if (r.sessionId !== sessionId) continue;
    if (r.proc) { try { stopRoutine(state, r.name); } catch {} }
    stopped.push(r.name);
  }
  return stopped;
}

/** Permanently delete every definition bound to a deleted session. */
export function deleteSessionRoutines(state, sessionId) {
  if (!sessionId) return [];
  listRoutines(state);
  const deleted = [];
  for (const r of [...routinesMap(state).values()]) {
    if (r.sessionId !== sessionId) continue;
    if (r.proc) {
      const proc = r.proc;
      r.proc = null;
      proc.removeAllListeners?.("exit");
      try { process.kill(-proc.pid, "SIGTERM"); } catch { try { proc.kill("SIGTERM"); } catch {} }
    }
    routineRepository(state).delete(r.id);
    for (const artifact of [r.path, r.executionPath]) {
      if (!artifact) continue;
      try { unlinkSync(artifact); } catch (error) { if (error.code !== "ENOENT") throw new Error(`failed to delete ${artifact}: ${error.message}`); }
    }
    r.sessionId = null;
    r.cwd = null;
    routinesMap(state).delete(r.name);
    deleted.push(r.name);
    emit(state, r, "deleted");
  }
  invalidateRoutinesCache();
  return deleted;
}

/** Release every routine bound to a session without deleting its definition. */
export function releaseSessionRoutines(state, sessionId) {
  if (!sessionId) return [];
  listRoutines(state); // make sure persisted bindings are materialized
  const released = [];
  for (const r of routinesMap(state).values()) {
    if (r.sessionId !== sessionId) continue;
    if (r.proc) { try { stopRoutine(state, r.name); } catch {} }
    routineRepository(state).release(r.id, new Date().toISOString());
    r.sessionId = null;
    r.cwd = null;
    released.push(r.name);
    emit(state, r, "released");
  }
  invalidateRoutinesCache();
  return released;
}

/** Kill every running routine (server shutdown). */
export function stopAllRoutines(state) {
  for (const r of state.routines?.values() ?? []) {
    if (!r.proc) continue;
    try { process.kill(-r.proc.pid, "SIGKILL"); } catch { try { r.proc.kill("SIGKILL"); } catch {} }
  }
}
