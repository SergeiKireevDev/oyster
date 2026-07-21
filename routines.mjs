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
 * Definitions, bindings, status, progress, results, and logs live only in
 * SQLite. `state.routineRuntime` contains only live ChildProcess handles and
 * their readline stream readers, keyed by persistent routine id.
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


export function routinesDir() {
  return ROUTINES_DIR;
}

/** Client-safe routine views contain only persisted data plus derived liveness. */
export function routineInfo(routine) {
  const { proc: _proc, readers: _readers, ...info } = routine;
  return { ...info, alive: routine.alive ?? !!routine.proc };
}

function routineRepository(state) {
  const repository = state.appStore?.repositories?.routines;
  if (!repository) throw new Error("routine repository is required");
  return repository;
}

// This is the entire routine runtime registry. Durable definitions and run
// state are always rebuilt from SQLite.
function routineRuntime(state) {
  if (!state.routineRuntime) state.routineRuntime = new Map();
  return state.routineRuntime;
}

function routineView(state, definition) {
  const repository = routineRepository(state);
  const run = repository.findLatestRun(definition.id);
  const runtime = routineRuntime(state).get(definition.id);
  const logs = run ? repository.listLogs(run.id).map((line) => line.text) : [];
  return {
    name: definition.name,
    path: join(ROUTINES_DIR, definition.name),
    sessionId: definition.session_id ?? null,
    cwd: definition.cwd ?? null,
    status: run?.status ?? "idle",
    progress: run?.progress ?? null,
    message: run?.message ?? run?.result ?? run?.error ?? null,
    startedAt: run?.started_at ?? null,
    finishedAt: run?.finished_at ?? null,
    exitCode: run?.exit_code ?? null,
    log: logs,
    alive: !!runtime?.proc,
  };
}

function emit(state, definition, reason) {
  state.serverEvent({ type: "routine_update", reason, routine: routineView(state, definition) });
}

export function listRoutines(state) {
  return routineRepository(state).list().map((row) => routineView(state, row));
}

function findRoutine(state, name) {
  return routineRepository(state).findByName(name);
}

function activeRuntime(state, definition) {
  return routineRuntime(state).get(definition.id) ?? null;
}

function runScript(state, definition, mode) {
  const repository = routineRepository(state);
  const cwd = definition.cwd && existsSync(definition.cwd) ? definition.cwd : state.currentDir;
  const executionPath = materializeRoutineScript({
    ...definition,
    ...(state.routineRuntimeDir ? { runtimeDir: state.routineRuntimeDir } : {}),
  });
  const proc = spawn(executionPath, [mode], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const readers = new Set();
  const runtime = { proc, readers };
  routineRuntime(state).set(definition.id, runtime);
  const run = repository.createRun({
    id: randomUUID(), routineId: definition.id, mode,
    status: mode === "run" ? "running" : "teardown",
    startedAt: new Date().toISOString(),
  });
  if (mode === "run") repository.updateProgress(run.id, 0, null);
  console.log(`[pi-ui] routine ${mode}: ${executionPath} (pid ${proc.pid}, cwd ${cwd}, session ${definition.session_id ?? "-"})`);
  emit(state, definition, mode === "run" ? "started" : "teardown_started");

  const onLine = (stream) => (value) => {
    const line = value.trimEnd();
    if (!line) return;
    const match = line.match(PROGRESS_RE);
    if (match) {
      const current = repository.findRun(run.id);
      const progress = match[1] === undefined ? current?.progress ?? null : Math.min(100, Number(match[1]));
      const message = match[2] || current?.message || null;
      repository.updateProgress(run.id, progress, message);
      emit(state, definition, "progress");
      return;
    }
    repository.appendLog(run.id, stream, line, new Date().toISOString(), LOG_MAX);
    emit(state, definition, "output");
  };
  const stdoutReader = createInterface({ input: proc.stdout }).on("line", onLine("stdout"));
  const stderrReader = createInterface({ input: proc.stderr }).on("line", onLine("stderr"));
  readers.add(stdoutReader);
  readers.add(stderrReader);

  const clearRuntime = () => {
    if (routineRuntime(state).get(definition.id) !== runtime) return false;
    for (const reader of readers) reader.close();
    routineRuntime(state).delete(definition.id);
    return true;
  };

  proc.on("error", (error) => {
    if (!clearRuntime()) return;
    repository.finishRun(run.id, { status: "failed", error: error.message, finishedAt: new Date().toISOString() });
    emit(state, definition, "error");
  });

  proc.on("exit", (code, signal) => {
    if (!clearRuntime()) return;
    const current = repository.findRun(run.id);
    console.log(`[pi-ui] routine ${definition.name} ${mode} exited (code=${code}, signal=${signal})`);
    if (mode === "teardown") {
      repository.finishRun(run.id, {
        status: code === 0 ? "idle" : "failed",
        result: code === 0 ? "byproducts removed" : null,
        error: code === 0 ? null : (current?.message ?? `teardown failed (exit ${code})`),
        finishedAt: new Date().toISOString(), exitCode: code,
      });
      emit(state, definition, "teardown_finished");
    } else if (current?.status === "stopping") {
      repository.finishRun(run.id, { status: "stopped", finishedAt: new Date().toISOString(), exitCode: code });
      emit(state, definition, "stopped");
    } else {
      if (code === 0 && current?.progress !== null) repository.updateProgress(run.id, 100, current?.message ?? null);
      repository.finishRun(run.id, {
        status: code === 0 ? "done" : "failed",
        error: code === 0 ? null : (current?.message ?? `run failed (exit ${code})`),
        finishedAt: new Date().toISOString(), exitCode: code,
      });
      emit(state, definition, "finished");
    }
  });
}

export function createRoutine(state, { name, script, sessionId = null, ownerId = null, cwd = null }) {
  if (!/^[A-Za-z0-9][\w.-]*$/.test(name)) throw new Error(`invalid routine name: ${name}`);
  if (sessionId && !ownerId) throw new Error("session owner is required to bind a routine");
  const existing = findRoutine(state, name);
  if (existing && activeRuntime(state, existing)?.proc) throw new Error(`routine "${name}" is currently running — stop it before overwriting`);
  if (existing?.session_id && sessionId && existing.session_id !== sessionId) throw new Error(`routine "${name}" exists and is bound to another session`);
  const definition = routineRepository(state).upsert({
    id: existing?.id ?? randomUUID(), ownerId, name, script, cwd, now: new Date().toISOString(),
  });
  console.log(`[pi-ui] routine ${existing ? "updated" : "created"}: ${join(ROUTINES_DIR, name)} (session ${definition.session_id ?? "-"})`);
  emit(state, definition, existing ? "updated" : "created");
  return routineView(state, definition);
}

export function deleteRoutine(state, name) {
  const definition = findRoutine(state, name);
  if (!definition) throw new Error(`no such routine: ${name}`);
  if (activeRuntime(state, definition)?.proc) throw new Error(`routine "${name}" is running — stop it first`);
  const view = routineView(state, definition);
  routineRepository(state).delete(definition.id);
  try { unlinkSync(join(ROUTINES_DIR, name)); } catch (error) { if (error.code !== "ENOENT") throw new Error(`failed to delete routine artifact: ${error.message}`); }
  state.serverEvent({ type: "routine_update", reason: "deleted", routine: view });
  return view;
}

export function startRoutine(state, name, { sessionId = null, ownerId = null, cwd = null } = {}) {
  let definition = findRoutine(state, name);
  if (!definition) throw new Error(`no such routine: ${name}`);
  if (activeRuntime(state, definition)?.proc) throw new Error(`routine "${name}" is already running`);
  if (definition.session_id && sessionId && definition.session_id !== sessionId) throw new Error(`routine "${name}" is bound to another session — release it there first`);
  if (sessionId) {
    if (!ownerId) throw new Error("session owner is required to bind a routine");
    routineRepository(state).bind(definition.id, ownerId, cwd, new Date().toISOString());
    definition = findRoutine(state, name);
  }
  runScript(state, definition, "run");
  return routineView(state, definition);
}

export function stopRoutine(state, name) {
  const definition = findRoutine(state, name);
  if (!definition) throw new Error(`no such routine: ${name}`);
  const runtime = activeRuntime(state, definition);
  if (!runtime?.proc) throw new Error(`routine "${name}" is not running`);
  const run = routineRepository(state).findLatestRun(definition.id);
  if (run) routineRepository(state).updateRunStatus(run.id, "stopping");
  emit(state, definition, "stopping");
  const pid = runtime.proc.pid;
  try { process.kill(-pid, "SIGTERM"); } catch { try { runtime.proc.kill("SIGTERM"); } catch {} }
  setTimeout(() => { try { process.kill(-pid, "SIGKILL"); } catch {} }, 4000).unref();
  return routineView(state, definition);
}

export function teardownRoutine(state, name) {
  const definition = findRoutine(state, name);
  if (!definition) throw new Error(`no such routine: ${name}`);
  if (activeRuntime(state, definition)?.proc) throw new Error(`routine "${name}" is running — stop it first`);
  runScript(state, definition, "teardown");
  return routineView(state, definition);
}

export function releaseRoutine(state, name) {
  let definition = findRoutine(state, name);
  if (!definition) throw new Error(`no such routine: ${name}`);
  if (activeRuntime(state, definition)?.proc) throw new Error(`routine "${name}" is running — stop it first`);
  routineRepository(state).release(definition.id, new Date().toISOString());
  definition = findRoutine(state, name);
  emit(state, definition, "released");
  return routineView(state, definition);
}

export function stopSessionRoutines(state, sessionId) {
  if (!sessionId) return [];
  const stopped = [];
  for (const definition of routineRepository(state).list().filter((row) => row.session_id === sessionId)) {
    if (activeRuntime(state, definition)?.proc) try { stopRoutine(state, definition.name); } catch {}
    stopped.push(definition.name);
  }
  return stopped;
}

export function deleteSessionRoutines(state, sessionId) {
  if (!sessionId) return [];
  const deleted = [];
  for (const definition of routineRepository(state).list().filter((row) => row.session_id === sessionId)) {
    const runtime = activeRuntime(state, definition);
    if (runtime?.proc) {
      runtime.proc.removeAllListeners?.("exit");
      for (const reader of runtime.readers) reader.close();
      try { process.kill(-runtime.proc.pid, "SIGTERM"); } catch { try { runtime.proc.kill("SIGTERM"); } catch {} }
      routineRuntime(state).delete(definition.id);
    }
    const view = routineView(state, definition);
    routineRepository(state).delete(definition.id);
    try { unlinkSync(join(ROUTINES_DIR, definition.name)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    deleted.push(definition.name);
    state.serverEvent({ type: "routine_update", reason: "deleted", routine: view });
  }
  return deleted;
}

export function releaseSessionRoutines(state, sessionId) {
  if (!sessionId) return [];
  const released = [];
  for (let definition of routineRepository(state).list().filter((row) => row.session_id === sessionId)) {
    if (activeRuntime(state, definition)?.proc) try { stopRoutine(state, definition.name); } catch {}
    routineRepository(state).release(definition.id, new Date().toISOString());
    definition = findRoutine(state, definition.name);
    released.push(definition.name);
    emit(state, definition, "released");
  }
  return released;
}

export function stopAllRoutines(state) {
  for (const runtime of state.routineRuntime?.values() ?? []) {
    try { process.kill(-runtime.proc.pid, "SIGKILL"); } catch { try { runtime.proc.kill("SIGKILL"); } catch {} }
  }
}
