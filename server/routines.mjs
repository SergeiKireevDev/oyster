/**
 * oyster — routine manager
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
 * SQLite. `state.routineRuntime` contains only live ChildProcess handles,
 * stream readers, and forced-stop timers, keyed by persistent routine id.
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
const STOP_GRACE_MS = 4000;
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

function signalProcessGroup(proc, signal) {
  const pid = proc?.pid;
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {}
  }
  try { proc?.kill(signal); } catch {}
}

function terminateRuntime(runtime) {
  signalProcessGroup(runtime.proc, "SIGTERM");
  if (runtime.stopTimer) return;
  runtime.stopTimer = setTimeout(() => {
    runtime.stopTimer = null;
    signalProcessGroup(runtime.proc, "SIGKILL");
  }, STOP_GRACE_MS);
  runtime.stopTimer.unref();
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
  const runtime = { proc, readers, stopTimer: null };
  routineRuntime(state).set(definition.id, runtime);
  const run = repository.createRun({
    id: randomUUID(), routineId: definition.id, mode,
    status: mode === "run" ? "running" : "teardown",
    startedAt: new Date().toISOString(),
  });
  if (mode === "run") repository.updateProgress(run.id, 0, null);
  console.log(`[oyster] routine ${mode}: ${executionPath} (pid ${proc.pid}, cwd ${cwd}, session ${definition.session_id ?? "-"})`);
  emit(state, definition, mode === "run" ? "started" : "teardown_started");

  const onLine = (stream) => (value) => {
    const line = value.trimEnd();
    if (!line) return;
    const match = line.match(PROGRESS_RE);
    if (match) {
      const current = repository.findRun(run.id);
      const requested = match[1] === undefined ? current?.progress ?? null : Math.min(100, Number(match[1]));
      const progress = requested === null || current?.progress === null || current?.progress === undefined
        ? requested
        : Math.max(current.progress, requested);
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
    for (const reader of readers) reader.close();
    if (runtime.stopTimer) clearTimeout(runtime.stopTimer);
    runtime.stopTimer = null;
    if (routineRuntime(state).get(definition.id) !== runtime) return false;
    routineRuntime(state).delete(definition.id);
    return true;
  };

  let spawnError = null;
  proc.once("error", (error) => { spawnError = error; });

  // `close`, unlike `exit`, waits for stdio to drain. Finalizing on `exit`
  // could otherwise discard the script's last log or progress line.
  proc.once("close", (code, signal) => {
    if (!clearRuntime()) return;
    if (spawnError) {
      repository.finishRun(run.id, { status: "failed", error: spawnError.message, finishedAt: new Date().toISOString() });
      emit(state, definition, "error");
      return;
    }
    const current = repository.findRun(run.id);
    console.log(`[oyster] routine ${definition.name} ${mode} exited (code=${code}, signal=${signal})`);
    const exitReason = signal ? `signal ${signal}` : `exit ${code}`;
    if (current?.status === "stopping") {
      repository.finishRun(run.id, { status: "stopped", finishedAt: new Date().toISOString(), exitCode: code });
      emit(state, definition, "stopped");
    } else if (mode === "teardown") {
      repository.finishRun(run.id, {
        status: code === 0 ? "idle" : "failed",
        result: code === 0 ? "byproducts removed" : null,
        error: code === 0 ? null : (current?.message ?? `teardown failed (${exitReason})`),
        finishedAt: new Date().toISOString(), exitCode: code,
      });
      emit(state, definition, "teardown_finished");
    } else {
      if (code === 0 && current?.progress !== null) repository.updateProgress(run.id, 100, current?.message ?? null);
      repository.finishRun(run.id, {
        status: code === 0 ? "done" : "failed",
        error: code === 0 ? null : (current?.message ?? `run failed (${exitReason})`),
        finishedAt: new Date().toISOString(), exitCode: code,
      });
      emit(state, definition, "finished");
    }
  });
}

export function createRoutine(state, { name, script, sessionId = null, ownerId = null, cwd = null }) {
  if (typeof name !== "string" || !/^[A-Za-z0-9][\w.-]*$/.test(name)) throw new Error(`invalid routine name: ${name}`);
  if (typeof script !== "string") throw new Error("routine script must be a string");
  if (cwd !== null && typeof cwd !== "string") throw new Error("routine cwd must be a string or null");
  if (sessionId && !ownerId) throw new Error("session owner is required to bind a routine");
  const existing = findRoutine(state, name);
  if (existing && activeRuntime(state, existing)?.proc) throw new Error(`routine "${name}" is currently running — stop it before overwriting`);
  if (existing?.session_id && sessionId && existing.session_id !== sessionId) throw new Error(`routine "${name}" exists and is bound to another session`);
  const definition = routineRepository(state).upsert({
    id: existing?.id ?? randomUUID(),
    ownerId: sessionId ? ownerId : existing?.owner_id ?? null,
    name, script, cwd: cwd ?? existing?.cwd ?? null, now: new Date().toISOString(),
  });
  console.log(`[oyster] routine ${existing ? "updated" : "created"}: ${join(ROUTINES_DIR, name)} (session ${definition.session_id ?? "-"})`);
  emit(state, definition, existing ? "updated" : "created");
  return routineView(state, definition);
}

export function deleteRoutine(state, name) {
  const definition = findRoutine(state, name);
  if (!definition) throw new Error(`no such routine: ${name}`);
  if (activeRuntime(state, definition)?.proc) throw new Error(`routine "${name}" is running — stop it first`);
  const view = { ...routineView(state, definition), sessionId: null, cwd: null };
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
  } else if (cwd) {
    routineRepository(state).updateCwd(definition.id, cwd, new Date().toISOString());
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
  terminateRuntime(runtime);
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
      // Session deletion is irreversible, so do not leave a resistant
      // routine alive after detaching its durable definition.
      if (runtime.stopTimer) clearTimeout(runtime.stopTimer);
      runtime.stopTimer = null;
      signalProcessGroup(runtime.proc, "SIGKILL");
      for (const reader of runtime.readers) reader.close();
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

/** Run a one-shot agent that authors and registers a routine through the
 * bundled routine tool. The target session is explicit because this agent
 * deliberately has no durable session of its own. */
export function spawnRoutineAgent(state, { brief, sessionId }) {
  const text = String(brief ?? "").trim();
  if (!text) throw new Error("describe the routine to create");
  if (!sessionId) throw new Error("a current session is required to create a routine");
  const runner = [...state.runners.values()].find((candidate) => candidate.sessionId === sessionId);
  const cwd = runner?.dir ?? state.currentDir;
  const prompt = [
    "Create one durable oyster routine for the user request below.",
    "Use the routine tool with action=create and session_id exactly as supplied.",
    "Write the complete self-contained script yourself. It MUST handle both run and teardown,",
    "teardown MUST remove every byproduct made by run, it must not require interactive input,",
    "Plan explicit weighted steps for both modes and emit monotonic ::progress <0-100> <message> lines",
    "at startup, before and after every meaningful step, and at 100% only after success.",
    "For long-running steps, relay native done/total counts, subdivide or poll when possible,",
    "or emit a newline-flushed heartbeat at least every 30 seconds so progression never stalls.",
    "Do not merely write a file and do not start the routine. Choose a concise .sh name.",
    `Target session_id: ${sessionId}`,
    `User request: ${text}`,
  ].join("\n");

  return new Promise((resolvePromise, reject) => {
    const proc = state.piProcesses.ephemeral(["--no-session", "-p", prompt], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let tail = "";
    const capture = (chunk) => { tail = (tail + String(chunk)).slice(-3000); };
    proc.stdout.on("data", capture);
    proc.stderr.on("data", capture);
    let forceTimer = null;
    const timeout = setTimeout(() => {
      signalProcessGroup(proc, "SIGTERM");
      forceTimer = setTimeout(() => signalProcessGroup(proc, "SIGKILL"), STOP_GRACE_MS);
      forceTimer.unref();
      reject(new Error("timed out while the routine agent was working"));
    }, 5 * 60 * 1000);
    const clearTimers = () => {
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
    };
    proc.once("error", (error) => {
      clearTimers();
      reject(new Error(`failed to spawn routine agent: ${error.message}`));
    });
    proc.once("exit", (code, signal) => {
      clearTimers();
      if (code === 0) resolvePromise({ output: tail.trim() });
      else reject(new Error(`routine agent exited (${signal ?? code}): ${tail.trim().split("\n").at(-1) ?? "unknown error"}`));
    });
    proc.unref();
  });
}

export function stopAllRoutines(state) {
  const runtimes = state.routineRuntime;
  if (!runtimes) return;
  // Detach before signaling so late child events cannot write to a store that
  // the server is in the process of closing.
  state.routineRuntime = new Map();
  for (const runtime of runtimes.values()) {
    if (runtime.stopTimer) clearTimeout(runtime.stopTimer);
    runtime.stopTimer = null;
    for (const reader of runtime.readers) reader.close();
    signalProcessGroup(runtime.proc, "SIGKILL");
  }
}
