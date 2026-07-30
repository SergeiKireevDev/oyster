/**
 * oyster — pi runner manager
 *
 * One durable runner descriptor per opened session, with a pi process started
 * on demand when work is sent. Live runners keep working in the background
 * when the browser looks at another session; each SSE client
 * subscribes to exactly one runner, and runner status (busy/idle/dead) is
 * broadcast to everyone so session lists can show live indicators.
 *
 * Live runners are kept in `state.runners` (a Map owned by the stable core's
 * state object) so they survive hot reloads of app.mjs. Each value:
 *   {
 *     id:          "r-<uuid>" – durable opaque handle used by clients (?runner=id)
 *     dir:         string   – cwd the pi process runs in
 *     sessionRef:  object?  – backend-neutral persisted session identity
 *     sessionFile: string?  – JSONL compatibility path (never SQLite DB path)
 *     sessionId:   string?  – its session id (from get_state)
 *     sessionName: string?  – its session name (from get_state)
 *     busy:        boolean  – streaming/compacting right now
 *     proc:        ChildProcess|null
 *     resumeId / resumeQueue / resumeTimer – in-flight session resume state
 *     lastLineAt / probeSentAt / probeMisses / watchdogOk – health watchdog
 *   }
 *
 * Watchdog: a live pi process is not necessarily a responsive one (wedged
 * RPC loop, full stdin pipe). Every WATCHDOG_INTERVAL_MS we send a cheap
 * get_state to each runner that has subscribed SSE clients; any stdout line
 * counts as proof of life. Two consecutive silent probes → restart the
 * runner and tell its clients why. The get_state responses double as a
 * reconciler for a stuck `busy` flag (isStreaming/isCompacting overwrite it).
 */

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { createPiProcessLauncher } from "./pi-processes.mjs";
import { SESSION_TITLE_MESSAGE_LIMIT, summarizeSessionTitle } from "./session-titles.mjs";

const RUNNER_BUFFER_MAX = 400;
const WATCHDOG_INTERVAL_MS = 30000;
const WATCHDOG_MAX_MISSES = 2;

export const PINNED_ARTIFACT_SYSTEM_PROMPT = [
  "Artifact pinning policy:",
  "Whenever this session creates or materially updates a documentation or media file, use the pinned_widget tool to pin that file before completing the task.",
  "Documentation includes Markdown, text documents, PDFs, and standalone HTML files intended to be viewed directly; media includes images, audio, and video.",
  "Pin a standalone HTML artifact with pinned_widget so it appears in the Pinned Widgets viewer.",
  "If an HTML file is part of a web app or website being built or served, do not automatically pin or open it and do not automatically create a live-interface widget; only offer to open the app in a pinned widget, then wait for explicit user confirmation.",
  "When one task produces four or more qualifying files, call group_pinned_widgets once with a short descriptive group name in `group` and every artifact path in `paths`; this creates one dedicated pinned-widget group containing all of the task's qualifying files.",
  "Do not merely mention the artifacts, and do not pin other source code, configuration, or test files solely because of this policy.",
].join(" ");

// Pi processes that the user never sent a real message to (sessionName is
// still null) are leaked workers spawned for work that never followed through.
// They sit idle, burning RAM and
// cluttering the runner list. Reap them after MAX_ORPHAN_AGE_MS of nameless
// life — long enough to never kill an active-but-silent runner, short
// enough to fade abandoned ones out.
const MAX_ORPHAN_AGE_MS = 60 * 60 * 1000; // 1h
const ORAPHA_REAP_INTERVAL_MS = 10 * 60 * 1000; // 10 min

export const RUNNER_EPHEMERAL_FIELDS = Object.freeze([
  "proc", "stdoutReader", "busy", "resumeId", "resumeQueue", "resumeTimer",
  "lastSpawnAt", "lastLineAt", "probeSentAt", "probeMisses", "watchdogOk",
  "titleProcess", "titleSessionId", "initialArgs", "eventListeners",
]);
export const RUNNER_MANAGER_EPHEMERAL_FIELDS = Object.freeze(["runnerWatchdogTimer", "runnerReaperTimer"]);

function initializeRunnerRuntime(descriptor) {
  return {
    ...descriptor,
    proc: null,
    stdoutReader: null,
    busy: false,
    resumeId: null,
    resumeQueue: [],
    resumeTimer: null,
    lastSpawnAt: 0,
    lastLineAt: 0,
    probeSentAt: null,
    probeMisses: 0,
    watchdogOk: false,
    titleProcess: null,
    titleSessionId: null,
    initialArgs: Array.isArray(descriptor.initialArgs) ? [...descriptor.initialArgs] : [],
    eventListeners: descriptor.eventListeners instanceof Set ? descriptor.eventListeners : new Set(),
  };
}

function ensureRunnerRuntimeFields(runner) {
  const defaults = initializeRunnerRuntime({});
  for (const field of RUNNER_EPHEMERAL_FIELDS) {
    if (!(field in runner)) runner[field] = field === "resumeQueue" || field === "initialArgs"
      ? []
      : field === "eventListeners" ? new Set() : defaults[field];
  }
  return runner;
}

export function createRunnerManager(state, {
  spawnImpl = null, ensureSessionOwner = () => null, createRunnerId = randomUUID,
  appStore = state.appStore, now = () => new Date().toISOString(),
  summarizeTitle = summarizeSessionTitle,
  guardCallback = (callback) => callback,
} = {}) {
  if (typeof guardCallback !== "function") throw new TypeError("runner callback guard is required");
  const { config, serverEvent, sessionReferences } = state;
  const runnerRepository = appStore?.repositories?.runners ?? null;
  const runnerEventRepository = appStore?.repositories?.runnerEvents ?? null;
  const piProcesses = spawnImpl
    ? createPiProcessLauncher({ config, spawnImpl })
    : state.piProcesses;
  if (!piProcesses) throw new Error("pi process launcher is required");
  if (!sessionReferences) throw new Error("session reference codec is required");

  if (!state.runners) state.runners = new Map(); // stable id -> runner
  let persistedRunners = runnerRepository?.list() ?? [];
  const previouslyLive = persistedRunners.filter((runner) =>
    !state.runners.has(runner.id) && ["starting", "running"].includes(runner.last_status));
  if (previouslyLive.length) {
    const markInterrupted = (repositories) => {
      for (const runner of previouslyLive) repositories.runners.update(runner.id, {
        desired_state: "stopped", last_status: "interrupted", last_stopped_at: now(),
      });
    };
    if (appStore?.transaction) appStore.transaction(markInterrupted);
    else markInterrupted({ runners: runnerRepository });
    persistedRunners = runnerRepository.list();
  }
  for (const persisted of persistedRunners) {
    if (state.runners.has(persisted.id)) continue;
    const reference = persisted.session_backend
      ? sessionReferences.validate({
        backend: persisted.session_backend,
        id: persisted.session_id,
        storagePath: persisted.session_storage_path,
      })
      : null;
    state.runners.set(persisted.id, initializeRunnerRuntime({
      id: persisted.id,
      dir: persisted.dir,
      sessionRef: reference,
      sessionFile: reference?.backend === "jsonl" ? reference.storagePath : null,
      sessionId: reference?.id ?? null,
      sessionName: persisted.session_name,
      startCount: persisted.start_count,
    }));
  }
  const compatibleWithConfiguredBackend = (runner) => !runner?.sessionRef || runner.sessionRef.backend === config.PERSISTENT_STORE;
  const persistedDefault = persistedRunners.find((runner) => runner.is_default === 1
    && (!runner.session_backend || runner.session_backend === config.PERSISTENT_STORE));
  if (state.defaultRunnerId && (!state.runners.has(state.defaultRunnerId)
    || !compatibleWithConfiguredBackend(state.runners.get(state.defaultRunnerId)))) {
    state.defaultRunnerId = null;
    state.appSettings?.setDefaultRunnerId(null);
  }
  if (!state.defaultRunnerId && persistedDefault) {
    state.defaultRunnerId = persistedDefault.id;
    state.appSettings?.setDefaultRunnerId(persistedDefault.id);
  }
  for (const runner of state.runners.values()) {
    ensureRunnerRuntimeFields(runner);
    if (!runner.sessionRef && runner.sessionFile && runner.sessionId) {
      runner.sessionRef = sessionReferences.validate({
        backend: "jsonl",
        id: runner.sessionId,
        storagePath: runner.sessionFile,
      });
    }
  }

  // one-time migration from the single-process era: a pre-runner pi process
  // may survive a hot reload as state.pi; its stdout listeners belong to old
  // code, so retire it and let runners take over
  if (state.pi) {
    console.log("[oyster] retiring pre-runner pi process (multi-runner migration)");
    try { state.pi.kill("SIGTERM"); } catch {}
    state.pi = null;
  }

  let srvSeq = 0;
  /** fresh id for server-initiated rpc commands (responses are recognizable) */
  function srvId() {
    return `_srv-${++srvSeq}`;
  }

  function runnerInfo(r) {
    return {
      id: r.id,
      dir: r.dir,
      sessionRef: r.sessionRef ?? null,
      sessionKey: r.sessionRef ? sessionReferences.serialize(r.sessionRef) : null,
      sessionFile: r.sessionRef?.backend === "jsonl" ? r.sessionRef.storagePath : null,
      sessionId: r.sessionId,
      sessionName: r.sessionName,
      busy: r.busy,
      alive: !!r.proc,
    };
  }

  function listRunnerInfo() {
    return [...state.runners.values()].map(runnerInfo);
  }

  function replayRunnerEvents(runner) {
    return runnerEventRepository?.list(runner.id).map((event) => event.payload) ?? [];
  }

  /** Global notification. Ordinary lifecycle changes carry one runner delta;
   * destructive catalog changes can still request a full replacement. */
  function runnersChanged(changedRunner = null) {
    serverEvent({
      type: "runners_update",
      runners: changedRunner ? [runnerInfo(changedRunner)] : listRunnerInfo(),
      partial: Boolean(changedRunner),
    });
  }

  function withSseId(line) {
    try {
      const obj = JSON.parse(line);
      if (!obj._sseId) obj._sseId = randomUUID();
      return JSON.stringify(obj);
    } catch {
      return line;
    }
  }

  /** deliver a line only to SSE clients subscribed to this runner */
  function runnerWrite(runner, line) {
    const eventLine = withSseId(line);
    let event = null;
    let sseId = null;
    try {
      event = JSON.parse(eventLine);
      sseId = event._sseId ?? null;
    } catch {}
    runnerEventRepository?.append({
      runnerId: runner.id, sseId, payload: eventLine, createdAt: now(), maxEntries: RUNNER_BUFFER_MAX,
    });
    for (const res of state.sseClients) {
      if (res.runnerId !== runner.id) continue;
      if (res.writableEnded || res.destroyed) continue; // dead client, reaped on 'close'
      res.write(`data: ${eventLine}\n\n`);
    }
    if (event) {
      for (const listener of runner.eventListeners ?? []) {
        try { listener(event); }
        catch (error) { console.error(`[oyster] runner observer failed: ${error.message}`); }
      }
    }
  }

  function observeRunner(runner, listener) {
    if (typeof listener !== "function") throw new TypeError("runner observer must be a function");
    (runner.eventListeners ??= new Set()).add(listener);
    return () => runner.eventListeners?.delete(listener);
  }

  function runnerEvent(runner, obj) {
    runnerWrite(runner, JSON.stringify({ ...obj, _server: true, runner: runner.id }));
  }

  function titleEligible(name) {
    return !name || /^\u23EA [0-9a-f]{4,12}$/.test(name);
  }

  function maybeTitleSession(runner, sessionState) {
    const reference = runner.sessionRef;
    const sessionId = runner.sessionId;
    if (!reference || !sessionId || !titleEligible(runner.sessionName)) return;
    if ((sessionState.messageCount ?? 0) < 1 || runner.titleSessionId === sessionId) return;
    const catalog = state.sessionCatalog;
    if (!catalog?.messages) return;

    const identity = reference.backend === "sqlite" ? reference.id : reference.storagePath;
    let messages;
    try { messages = catalog.messages(identity)?.messages ?? []; }
    catch (error) {
      console.error(`[oyster] cannot read session ${sessionId} for title: ${error.message}`);
      return;
    }
    if (!messages.length) return;

    const originalName = runner.sessionName ?? null;
    runner.titleSessionId = sessionId;
    Promise.resolve(summarizeTitle(state.piProcesses, {
      cwd: runner.dir,
      messages: messages.slice(0, SESSION_TITLE_MESSAGE_LIMIT),
      model: sessionState.model ?? null,
      onSpawn: (proc) => { runner.titleProcess = proc; },
    })).then((title) => {
      if (!title || runner.sessionId !== sessionId || (runner.sessionName ?? null) !== originalName) return;
      const name = originalName ? `\u23EA ${title}` : title;
      if (!sendToRunner(runner, { id: srvId(), type: "set_session_name", name }, { autostart: false })) return;
      runner.sessionName = name;
      runnerRepository?.update(runner.id, { session_name: name });
      runnersChanged(runner);
    }).catch((error) => {
      console.error(`[oyster] cannot title session ${sessionId}: ${error.message}`);
    }).finally(() => {
      if (runner.titleSessionId === sessionId) runner.titleProcess = null;
    });
  }

  /** watch a runner's stdout to maintain busy/session metadata */
  function trackRunner(runner, line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type === "agent_start") { runner.busy = true; runnersChanged(runner); }
    else if (msg.type === "agent_end") { runner.busy = !!msg.willRetry; runnersChanged(runner); requestState(runner); }
    else if (msg.type === "agent_settled") { runner.busy = false; runnersChanged(runner); requestState(runner); }
    else if (msg.type === "compaction_start") { runner.busy = true; runnersChanged(runner); }
    else if (msg.type === "compaction_end" && msg.reason === "manual") { runner.busy = false; runnersChanged(runner); requestState(runner); }
    else if (msg.type === "response" && msg.id === runner.resumeId) {
      // session resume finished (success or not): deliver held-back commands
      finishResume(runner);
      if (msg.success) requestState(runner);
    }
    else if (msg.type === "response" && msg.success) {
      if (msg.command === "get_state" && msg.data) {
        const d = msg.data;
        let nextReference = runner.sessionRef ?? null;
        if (d.sessionId && d.sessionFile) {
          nextReference = sessionReferences.validate({ backend: "jsonl", id: d.sessionId, storagePath: d.sessionFile });
        } else if (d.sessionId && config.PERSISTENT_STORE === "sqlite") {
          nextReference = sessionReferences.validate({ backend: "sqlite", id: d.sessionId, storagePath: config.SQLITE_PATH });
        }
        const referenceChanged = nextReference && (!runner.sessionRef || !sessionReferences.equals(runner.sessionRef, nextReference));
        const sessionChanged = runner.sessionId && d.sessionId && runner.sessionId !== d.sessionId;
        const changed = referenceChanged || runner.sessionId !== d.sessionId || runner.sessionName !== d.sessionName;
        if (sessionChanged) {
          try { runner.titleProcess?.kill("SIGTERM"); } catch {}
          runner.titleProcess = null;
          runner.titleSessionId = null;
        }
        runner.sessionRef = nextReference;
        runner.sessionFile = nextReference?.backend === "jsonl" ? nextReference.storagePath : null;
        runner.sessionId = d.sessionId ?? runner.sessionId;
        runner.sessionName = d.sessionName ?? null;
        if (changed) {
          const owner = nextReference ? ensureSessionOwner(nextReference) : null;
          runnerRepository?.update(runner.id, {
            owner_id: owner?.id ?? null,
            session_backend: nextReference?.backend ?? null,
            session_id: nextReference?.id ?? null,
            session_storage_path: nextReference?.storagePath ?? null,
            session_name: runner.sessionName,
          });
        }
        runner.busy = !!(d.isStreaming || d.isCompacting);
        if (changed) runnersChanged(runner);
        maybeTitleSession(runner, d);
      } else if (["switch_session", "new_session", "set_session_name"].includes(msg.command)) {
        requestState(runner);
      }
    }
  }

  function requestState(runner) {
    sendToRunner(runner, { id: srvId(), type: "get_state" }, { autostart: false });
  }

  /** flush commands that were held back while a session resume was in flight */
  function finishResume(runner) {
    if (!runner.resumeId) return;
    runner.resumeId = null;
    clearTimeout(runner.resumeTimer);
    runner.resumeTimer = null;
    const queued = runner.resumeQueue ?? [];
    runner.resumeQueue = [];
    for (const obj of queued) {
      if (runner.proc?.stdin.writable) runner.proc.stdin.write(JSON.stringify(obj) + "\n");
    }
  }

  function allocateRunnerId() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const token = String(createRunnerId());
      const id = `r-${token}`;
      if (!/^r-[a-zA-Z0-9_-]{8,128}$/.test(id)) throw new Error("runner ID generator returned an invalid persistence-safe token");
      if (!state.runners.has(id)) return id;
    }
    throw new Error("runner ID generator repeatedly returned an existing ID");
  }

  function spawnRunner({ dir, sessionRef = null, autostart = true, initialArgs = [] }) {
    const reference = sessionRef ? sessionReferences.validate(sessionRef) : null;
    const owner = reference ? ensureSessionOwner(reference) : null;
    const id = allocateRunnerId();
    const createdAt = now();
    runnerRepository?.create({
      id, ownerId: owner?.id ?? null, dir,
      sessionBackend: reference?.backend ?? null,
      sessionId: reference?.id ?? null,
      sessionStoragePath: reference?.storagePath ?? null,
      desiredState: autostart ? "running" : "stopped",
      lastStatus: autostart ? "starting" : "stopped",
      createdAt,
    });
    const runner = initializeRunnerRuntime({
      id,
      dir,
      sessionRef: reference,
      sessionFile: reference?.backend === "jsonl" ? reference.storagePath : null,
      sessionId: reference?.id ?? null,
      sessionName: null,
      startCount: 0,
      initialArgs: [...initialArgs],
    });
    state.runners.set(runner.id, runner);
    if (autostart) startRunner(runner);
    return runner;
  }

  function startRunner(runner) {
    if (runner.proc) return;
    const nowMs = Date.now();
    // crash-loop guard: if this runner died within 2s of spawning, wait
    if (nowMs - runner.lastSpawnAt < 2000 && runner.startCount > 0) {
      setTimeout(() => { if (!runner.proc && state.runners.has(runner.id)) startRunner(runner); }, 2000);
      return;
    }
    runner.lastSpawnAt = nowMs;
    runner.startCount++;
    const startedAt = now();
    runnerRepository?.update(runner.id, {
      desired_state: "running", last_status: "starting", start_count: runner.startCount, last_started_at: startedAt,
    });
    const sqliteResumeArgs = runner.sessionRef?.backend === "sqlite" ? ["--session", runner.sessionRef.id] : [];
    const initialArgs = Array.isArray(runner.initialArgs) ? runner.initialArgs : [];
    runner.initialArgs = [];
    const args = [
      "--mode", "rpc",
      ...sqliteResumeArgs,
      ...initialArgs,
      ...config.PI_EXTRA_ARGS,
      "--append-system-prompt", PINNED_ARTIFACT_SYSTEM_PROMPT,
    ];
    console.log(`[oyster] spawning runner ${runner.id}: ${config.PI_BIN} ${args.join(" ")} (cwd: ${runner.dir})`);
    const proc = piProcesses.launch(args, {
      cwd: runner.dir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    runner.proc = proc;
    runnerRepository?.update(runner.id, { last_status: "running" });

    // health watchdog bookkeeping: only procs started by watchdog-aware
    // code update lastLineAt, so only those are probed (watchdogOk)
    runner.watchdogOk = true;
    runner.lastLineAt = Date.now();
    runner.probeSentAt = null;
    runner.probeMisses = 0;

    const rl = createInterface({ input: proc.stdout });
    runner.stdoutReader = rl;
    rl.on("line", (line) => {
      line = line.trim();
      if (!line) return;
      runner.lastLineAt = Date.now();
      trackRunner(runner, line);
      runnerWrite(runner, line);
    });

    proc.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) console.error(`[pi ${runner.id} stderr] ${text}`);
    });

    proc.on("error", (err) => {
      console.error(`[oyster] failed to spawn runner ${runner.id}: ${err.message}`);
      runnerEvent(runner, { type: "pi_error", error: err.message });
      if (runner.proc === proc) runner.proc = null;
      if (runner.stdoutReader === rl) runner.stdoutReader = null;
      runnerRepository?.update(runner.id, { last_status: "dead" });
      runnersChanged(runner);
    });

    proc.on("exit", (code, signal) => {
      console.log(`[oyster] runner ${runner.id} exited (code=${code}, signal=${signal})`);
      if (runner.proc === proc) {
        runner.proc = null;
        if (runner.stdoutReader === rl) runner.stdoutReader = null;
        runner.busy = false;
        runnerRepository?.update(runner.id, { last_status: "dead", last_stopped_at: now() });
        runnerEvent(runner, { type: "pi_exit", code, signal });
        runnersChanged(runner);
      }
    });

    // JSONL resumes retain the RPC switch contract. SQLite identity is not a
    // file, so it is selected atomically at process startup with --session.
    // Hold commands only for the JSONL switch race.
    if (runner.sessionRef?.backend === "jsonl") {
      runner.resumeId = srvId();
      proc.stdin.write(JSON.stringify({ id: runner.resumeId, type: "switch_session", sessionPath: runner.sessionRef.storagePath }) + "\n");
      // safety valve: never hold commands forever if the response goes missing
      clearTimeout(runner.resumeTimer);
      runner.resumeTimer = setTimeout(() => finishResume(runner), 15000);
      runner.resumeTimer.unref?.();
    } else {
      requestState(runner);
    }
    // Publish alive=true before pi_started. Clients use the start event to
    // request authoritative state, so delivering it first would leave a race
    // where their liveness guard still sees this runner as dormant.
    runnersChanged(runner);
    runnerEvent(runner, { type: "pi_started", startCount: runner.startCount });
  }

  function stopRunner(runner) {
    const proc = runner.proc;
    runnerRepository?.update(runner.id, { desired_state: "stopped", last_status: "stopped", last_stopped_at: now() });
    try { runner.titleProcess?.kill("SIGTERM"); } catch {}
    runner.titleProcess = null;
    if (!proc) return;
    runner.proc = null;
    runner.busy = false;
    clearTimeout(runner.resumeTimer);
    runner.resumeTimer = null;
    runner.resumeId = null;
    runner.resumeQueue = [];
    proc.removeAllListeners("exit");
    proc.on("exit", () => {
      runner.stdoutReader = null;
      runnerEvent(runner, { type: "pi_exit", code: null, signal: "SIGTERM" });
    });
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) proc.kill("SIGKILL");
    }, 3000).unref();
    runnersChanged(runner);
  }

  function sendToRunner(runner, obj, { autostart = true } = {}) {
    if (!runner.proc && autostart) startRunner(runner);
    if (!runner.proc || !runner.proc.stdin.writable) return false;
    if (runner.resumeId) {
      // a session resume is in flight; deliver after it completes
      (runner.resumeQueue ??= []).push(obj);
      return true;
    }
    runner.proc.stdin.write(JSON.stringify(obj) + "\n");
    return true;
  }

  /** the runner new/unspecified clients get; created on demand */
  function defaultRunner() {
    let r = state.runners.get(state.defaultRunnerId);
    if (!r) {
      const compatible = [...state.runners.values()].filter(compatibleWithConfiguredBackend);
      r = compatible.find((x) => x.proc) ?? compatible[0];
      if (!r) r = spawnRunner({ dir: state.currentDir });
      state.defaultRunnerId = r.id;
      runnerRepository?.setDefault(r.id);
      state.appSettings?.setDefaultRunnerId(r.id);
    }
    return r;
  }

  function runnerFromReq(url) {
    const id = url.searchParams.get("runner");
    const requested = id ? state.runners.get(id) : null;
    return (requested && compatibleWithConfiguredBackend(requested)) ? requested : defaultRunner();
  }

  /** Reuse the runner attached to the full session identity, else spawn one. */
  function openSessionRunner({ sessionRef = null, sessionPath = null, sessionId = null, dir = null }) {
    const inputReference = sessionRef ?? (sessionPath && sessionId
      ? { backend: "jsonl", id: sessionId, storagePath: sessionPath }
      : null);
    const reference = inputReference ? sessionReferences.validate(inputReference) : null;
    if (reference) {
      for (const r of state.runners.values()) {
        if (r.sessionRef && sessionReferences.equals(r.sessionRef, reference)) return r;
      }
    }
    // Brand-new sessions need pi to establish their durable identity. Saved
    // sessions already have an identity and can remain dormant while read.
    return spawnRunner({ dir: dir || state.currentDir, sessionRef: reference, autostart: !reference });
  }

  // ------------------------------------------------------------ watchdog

  /** does any connected SSE client watch this runner? */
  function hasSubscribers(runner) {
    for (const res of state.sseClients) {
      if (res.runnerId === runner.id && !res.writableEnded && !res.destroyed) return true;
    }
    return false;
  }

  function watchdogTick() {
    for (const runner of state.runners.values()) {
      // skip: dead proc (nothing to probe), pre-watchdog proc (lastLineAt
      // never updates), resume in flight (probes would be held in the
      // resume queue and read as misses)
      if (!runner.proc || !runner.watchdogOk || runner.resumeId) continue;
      if (!hasSubscribers(runner)) {
        runner.probeSentAt = null;
        runner.probeMisses = 0;
        continue;
      }
      if (runner.probeSentAt && runner.lastLineAt < runner.probeSentAt) {
        // total silence since the last probe — not even a get_state response
        runner.probeMisses = (runner.probeMisses ?? 0) + 1;
        if (runner.probeMisses >= WATCHDOG_MAX_MISSES) {
          console.warn(`[oyster] runner ${runner.id} unresponsive (${runner.probeMisses} silent probes), restarting`);
          runner.probeSentAt = null;
          runner.probeMisses = 0;
          runnerEvent(runner, {
            type: "runner_unhealthy",
            reason: "pi did not answer health probes", action: "restart",
          });
          stopRunner(runner);
          startRunner(runner);
          continue;
        }
      } else {
        runner.probeMisses = 0;
      }
      runner.probeSentAt = Date.now();
      requestState(runner); // any stdout before the next tick counts as alive
    }
  }

  // one interval, owned by the CURRENT module version: clear the previous
  // one on hot reload so ticks never double up or run stale closures
  clearInterval(state.runnerWatchdogTimer);
  state.runnerWatchdogTimer = setInterval(guardCallback(watchdogTick), WATCHDOG_INTERVAL_MS);
  state.runnerWatchdogTimer.unref?.();

  // ------------------------------------------------------------ orphan reaper
  // A runner the user never sent a prompt to has sessionName === null. If it
  // has been alive that long without ever earning a name, it's a leaked
  // worker — stop its process so it stops burning RAM and disappears from
  // the swipe carousel. Dead shells stay in the map for instant restart on
  // next command (opening the session alone leaves the shell dormant).
  function reaperTick() {
    const now = Date.now();
    for (const runner of state.runners.values()) {
      if (!runner.proc) continue; // already stopped
      if (runner.sessionName) continue; // user actually talked to it
      // lastLineAt is set at spawn and bumped on every stdout line — use
      // it as "when this runner became alive"
      if (now - runner.lastLineAt <= MAX_ORPHAN_AGE_MS) continue;
      console.log(
        `[oyster] reaping orphan runner ${runner.id} (alive ${Math.round((now - runner.lastLineAt) / 60000)}min, no session name) in ${runner.dir}`
      );
      stopRunner(runner);
    }
  }

  clearInterval(state.runnerReaperTimer);
  state.runnerReaperTimer = setInterval(guardCallback(reaperTick), ORAPHA_REAP_INTERVAL_MS);
  state.runnerReaperTimer.unref?.();

  // Startup and read-only session selection only restore descriptors. An RPC
  // command that requests work starts the selected process.
  function startPi() {}
  function stopPi() { for (const r of state.runners.values()) stopRunner(r); }

  return {
    srvId, runnerInfo, listRunnerInfo, replayRunnerEvents, runnersChanged,
    spawnRunner, startRunner, stopRunner, sendToRunner, observeRunner,
    defaultRunner, runnerFromReq, openSessionRunner,
    startPi, stopPi,
  };
}
