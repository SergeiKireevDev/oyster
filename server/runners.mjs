/**
 * oyster — coding-agent runner manager
 *
 * One durable runner descriptor per opened session, with a driver-managed
 * process started on demand when work is sent. Live runners keep working in the background
 * when the browser looks at another session; each SSE client
 * subscribes to exactly one runner, and runner status (busy/idle/dead) is
 * broadcast to everyone so session lists can show live indicators.
 *
 * Live runners are kept in `state.runners` (a Map owned by the stable core's
 * state object) so they survive hot reloads of app.mjs. Each value:
 *   {
 *     id:          "r-<uuid>" – durable opaque handle used by clients (?runner=id)
 *     dir:         string   – cwd the coding-agent process runs in
 *     sessionRef:  object?  – backend-neutral persisted session identity
 *     sessionFile: string?  – JSONL compatibility path (never SQLite DB path)
 *     sessionId:   string?  – its session id (from get_state)
 *     sessionName: string?  – its session name (from get_state)
 *     busy:        boolean  – streaming/compacting right now
 *     attentionStatus / attentionUnread – durable result or clarification state
 *     proc:        ChildProcess|null
 *     resumeId / resumeQueue / resumeTimer – in-flight session resume state
 *     lastLineAt / probeSentAt / probeMisses / watchdogOk – health watchdog
 *   }
 *
 * Watchdog: a live process is not necessarily responsive (wedged protocol
 * loop, full stdin pipe). Every WATCHDOG_INTERVAL_MS we ask the selected
 * driver for a state command for each subscribed runner; any stdout line
 * counts as proof of life. Two consecutive silent probes → restart the
 * runner and tell its clients why. The get_state responses double as a
 * reconciler for a stuck `busy` flag (isStreaming/isCompacting overwrite it).
 */

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { validateRunnerDriver } from "./runner-drivers/contract.mjs";
import { createRunnerDriverRegistry, validateRunnerDriverRegistry } from "./runner-drivers/registry.mjs";
import { SESSION_TITLE_MESSAGE_LIMIT, summarizeSessionTitle } from "./session-titles.mjs";
import { normalizeLastEventId, sseDataFrame } from "./sse.mjs";

const RUNNER_BUFFER_MAX = 400;
const RUNNER_EVENT_MAX_BYTES = 1024 * 1024;
// These events contain cumulative or request-scoped snapshots. Replaying them
// is unnecessary because reconnects finish with an authoritative state and
// transcript reload; persisting every streaming update also creates an
// unbounded SQLite operation backlog under active runners.
const NON_REPLAYABLE_RUNNER_EVENTS = new Set([
  "response", "message_update", "tool_execution_update", "agent_end", "turn_end",
]);
const WATCHDOG_INTERVAL_MS = 30000;
const WATCHDOG_MAX_MISSES = 2;
const CLARIFICATION_METHODS = new Set(["select", "confirm", "input", "editor"]);

export const PINNED_ARTIFACT_SYSTEM_PROMPT = [
  "Artifact pinning policy:",
  "Whenever this session creates or materially updates a documentation or media file, use the pinned_widget tool to pin that file before completing the task.",
  "Documentation includes Markdown, text documents, PDFs, and standalone HTML files intended to be viewed directly; media includes images, audio, and video.",
  "Pin a standalone HTML artifact with pinned_widget so it appears in the Pinned Widgets viewer.",
  "If an HTML file is part of a web app or website being built or served, do not automatically pin or open it and do not automatically create a live-interface widget; only offer to open the app in a pinned widget, then wait for explicit user confirmation.",
  "When one task produces four or more qualifying files, call group_pinned_widgets once with a short descriptive group name in `group` and every artifact path in `paths`; this creates one dedicated pinned-widget group containing all of the task's qualifying files.",
  "Do not merely mention the artifacts, and do not pin other source code, configuration, or test files solely because of this policy.",
].join(" ");

// Coding-agent processes that never received a real message (sessionName is
// still null) are leaked workers spawned for work that never followed through.
// They sit idle, burning RAM and
// cluttering the runner list. Reap them after MAX_ORPHAN_AGE_MS of nameless
// life — long enough to never kill an active-but-silent runner, short
// enough to fade abandoned ones out.
const MAX_ORPHAN_AGE_MS = 60 * 60 * 1000; // 1h
const ORPHAN_REAP_INTERVAL_MS = 10 * 60 * 1000; // 10 min

export const RUNNER_EPHEMERAL_FIELDS = Object.freeze([
  "proc", "stdoutReader", "driverEmit", "driverRuntime", "busy", "resumeId", "resumeQueue", "resumeTimer", "startTimer",
  "lastSpawnAt", "lastLineAt", "probeSentAt", "probeMisses", "watchdogOk",
  "titleProcess", "titleSessionId", "titleLoadingSessionId", "initialArgs", "eventListeners", "subagentStatus",
  "pendingExtensionUiRequestIds",
]);
export const RUNNER_MANAGER_EPHEMERAL_FIELDS = Object.freeze(["runnerWatchdogTimer", "runnerReaperTimer"]);

function initializeRunnerRuntime(descriptor) {
  return {
    ...descriptor,
    proc: null,
    stdoutReader: null,
    driverEmit: null,
    driverRuntime: null,
    busy: false,
    resumeId: null,
    resumeQueue: [],
    resumeTimer: null,
    startTimer: null,
    lastSpawnAt: 0,
    lastLineAt: 0,
    probeSentAt: null,
    probeMisses: 0,
    watchdogOk: false,
    titleProcess: null,
    titleSessionId: null,
    titleLoadingSessionId: null,
    initialArgs: Array.isArray(descriptor.initialArgs) ? [...descriptor.initialArgs] : [],
    eventListeners: descriptor.eventListeners instanceof Set ? descriptor.eventListeners : new Set(),
    pendingExtensionUiRequestIds: descriptor.pendingExtensionUiRequestIds instanceof Set
      ? descriptor.pendingExtensionUiRequestIds
      : new Set(),
    subagentStatus: descriptor.subagentStatus ?? null,
  };
}

function ensureRunnerRuntimeFields(runner) {
  const defaults = initializeRunnerRuntime({});
  for (const field of RUNNER_EPHEMERAL_FIELDS) {
    if (!(field in runner)) runner[field] = field === "resumeQueue" || field === "initialArgs"
      ? []
      : field === "eventListeners" || field === "pendingExtensionUiRequestIds" ? new Set() : defaults[field];
  }
  return runner;
}

export async function createRunnerManager(state, {
  ensureSessionOwner = () => null, createRunnerId = randomUUID,
  appStore = undefined, now = () => new Date().toISOString(),
  summarizeTitle = summarizeSessionTitle,
  unarchiveSession = null,
  guardCallback = (callback) => callback,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  notifyRunnerEvent = () => {},
  runnerDriver: configuredRunnerDriver = null,
  runnerDrivers: configuredRunnerDrivers = null,
} = {}) {
  if (!state || typeof state !== "object") throw new TypeError("runner state is required");
  if (typeof guardCallback !== "function") throw new TypeError("runner callback guard is required");
  if (typeof setTimer !== "function" || typeof clearTimer !== "function") throw new TypeError("runner timer functions are required");
  if (typeof notifyRunnerEvent !== "function") throw new TypeError("runner notification callback is required");
  if (appStore === undefined) appStore = state.appStore;
  const { config, serverEvent, sessionReferences } = state;
  if (!config || typeof config !== "object") throw new TypeError("runner config is required");
  if (typeof serverEvent !== "function") throw new TypeError("serverEvent is required");
  if (!(state.sseClients instanceof Set)) throw new TypeError("sseClients must be a Set");
  const runnerRepository = appStore?.repositories?.runners ?? null;
  const runnerEventRepository = appStore?.repositories?.runnerEvents ?? null;
  const runnerDrivers = validateRunnerDriverRegistry(configuredRunnerDrivers ?? createRunnerDriverRegistry({
    drivers: [validateRunnerDriver(configuredRunnerDriver)],
    defaultId: configuredRunnerDriver.id,
  }));
  const driverFor = (runner) => runnerDrivers.get(runner?.harness ?? runnerDrivers.defaultId);
  if (!sessionReferences) throw new Error("session reference codec is required");

  if (!state.runners) state.runners = new Map(); // stable id -> runner
  let persistedRunners = await runnerRepository?.list() ?? [];
  const previouslyLive = persistedRunners.filter((runner) =>
    !state.runners.has(runner.id) && ["starting", "running"].includes(runner.last_status));
  if (previouslyLive.length) {
    const markInterrupted = async (repositories) => {
      for (const runner of previouslyLive) await repositories.runners.update(runner.id, {
        desired_state: "stopped", last_status: "interrupted", last_stopped_at: now(),
      });
    };
    if (appStore?.transaction) await appStore.transaction(markInterrupted);
    else markInterrupted({ runners: runnerRepository });
    persistedRunners = await runnerRepository.list();
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
      harness: persisted.harness ?? runnerDrivers.defaultId,
      sessionRef: reference,
      sessionFile: reference?.backend === "jsonl" ? reference.storagePath : null,
      sessionId: reference?.id ?? null,
      sessionName: persisted.session_name,
      attentionStatus: persisted.attention_status ?? null,
      attentionUnread: persisted.attention_unread === 1,
      startCount: persisted.start_count,
    }));
  }
  const compatibleWithConfiguredBackend = (runner) => {
    try { return driverFor(runner).isSessionCompatible(runner?.sessionRef ?? null); }
    catch { return false; }
  };
  const persistedDefault = persistedRunners.find((runner) => runner.is_default === 1
    && compatibleWithConfiguredBackend(state.runners.get(runner.id)));
  if (state.defaultRunnerId && (!state.runners.has(state.defaultRunnerId)
    || !compatibleWithConfiguredBackend(state.runners.get(state.defaultRunnerId)))) {
    state.defaultRunnerId = null;
    await state.appSettings?.setDefaultRunnerId(null);
  }
  if (!state.defaultRunnerId && persistedDefault) {
    state.defaultRunnerId = persistedDefault.id;
    await state.appSettings?.setDefaultRunnerId(persistedDefault.id);
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
      harness: r.harness ?? runnerDrivers.defaultId,
      sessionRef: r.sessionRef ?? null,
      sessionKey: r.sessionRef ? sessionReferences.serialize(r.sessionRef) : null,
      sessionFile: r.sessionRef?.backend === "jsonl" ? r.sessionRef.storagePath : null,
      sessionId: r.sessionId,
      sessionName: r.sessionName,
      attentionStatus: r.attentionStatus ?? null,
      attentionUnread: Boolean(r.attentionUnread),
      busy: r.busy,
      alive: !!r.proc,
      ...(r.subagentStatus ? { subagentStatus: r.subagentStatus } : {}),
    };
  }

  function listRunnerInfo() {
    return [...state.runners.values()].map(runnerInfo);
  }

  async function replayRunnerEvents(runner, { afterSseId = null } = {}) {
    // Oversized historical RPC responses are stale after a page load and can
    // otherwise block the event loop while gigabytes are replayed before the
    // browser ever receives replay_done. Resolved extension prompts must not
    // reopen on every refresh; only replay requests still awaiting a response.
    const stored = await runnerEventRepository?.list(runner.id, { maxPayloadBytes: RUNNER_EVENT_MAX_BYTES }) ?? [];
    const cursor = normalizeLastEventId(afterSseId);
    const cursorIndex = cursor === null ? -1 : stored.findIndex((event) => event.sse_id === cursor);
    // An unknown cursor may have fallen out of the bounded replay window. Replay
    // the complete retained window and let the browser's SSE-ID deduper discard
    // duplicates rather than risk skipping events.
    const replayable = cursor !== null && cursorIndex >= 0 ? stored.slice(cursorIndex + 1) : stored;
    return replayable
      .map((event) => event.payload)
      .filter((payload) => {
        try {
          const event = JSON.parse(payload);
          return event.type !== "extension_ui_request" || runner.pendingExtensionUiRequestIds.has(event.id);
        } catch {
          return true;
        }
      });
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

  function setRunnerAttention(runner, status, unread = status !== null) {
    if ((runner.attentionStatus ?? null) === status && Boolean(runner.attentionUnread) === Boolean(unread)) return false;
    runner.attentionStatus = status;
    runner.attentionUnread = Boolean(unread);
    runnersChanged(runner);
    void runnerRepository?.update(runner.id, {
      attention_status: status,
      attention_unread: unread ? 1 : 0,
    }).catch((error) => console.error(`[oyster] cannot persist runner ${runner.id} attention: ${error?.message ?? error}`));
    return true;
  }

  function acknowledgeRunnerAttention(runner) {
    if (!runner?.attentionUnread) return false;
    return setRunnerAttention(runner, runner.attentionStatus ?? null, false);
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
  async function runnerWrite(runner, line) {
    const eventLine = withSseId(line);
    let event = null;
    let sseId = null;
    try {
      event = JSON.parse(eventLine);
      sseId = event._sseId ?? null;
    } catch {}

    const replayable = !NON_REPLAYABLE_RUNNER_EVENTS.has(event?.type)
      && Buffer.byteLength(eventLine) <= RUNNER_EVENT_MAX_BYTES;
    // Only durable events become the browser's Last-Event-ID cursor. Advancing
    // the cursor for an intentionally non-replayable update could make a later
    // reconnect skip the next durable event.
    const frame = sseDataFrame(eventLine, { includeId: replayable });

    // Live delivery must never wait behind persistence I/O. In particular,
    // sqlite3 serializes repository operations, so awaiting an append here
    // used to delay both the active transcript and replay_done by the entire
    // queue of cumulative streaming snapshots.
    for (const res of state.sseClients) {
      if (res.runnerId !== runner.id) continue;
      if (res.writableEnded || res.destroyed) continue; // dead client, reaped on 'close'
      try { res.write(frame); }
      catch (error) { console.error(`[oyster] cannot write runner ${runner.id} event: ${error?.message ?? error}`); }
    }
    if (event) {
      for (const listener of runner.eventListeners ?? []) {
        try { listener(event); }
        catch (error) { console.error(`[oyster] runner observer failed: ${error.message}`); }
      }
    }

    if (replayable) {
      try {
        await runnerEventRepository?.append({
          runnerId: runner.id, sseId, payload: eventLine, createdAt: now(), maxEntries: RUNNER_BUFFER_MAX,
        });
      } catch (error) {
        console.error(`[oyster] cannot persist event for runner ${runner.id}: ${error?.message ?? error}`);
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

  async function maybeTitleSession(runner, sessionState) {
    const reference = runner.sessionRef;
    const sessionId = runner.sessionId;
    if (!reference || !sessionId || (state.sessionCatalog?.backend && reference.backend !== state.sessionCatalog.backend) || !titleEligible(runner.sessionName)) return;
    if ((sessionState.messageCount ?? 0) < 1 || runner.titleSessionId === sessionId || runner.titleLoadingSessionId === sessionId) return;
    const catalog = state.sessionCatalog;
    if (!catalog?.messages) return;

    const identity = reference.backend === "sqlite" ? reference.id : reference.storagePath;
    let messages;
    runner.titleLoadingSessionId = sessionId;
    try { messages = (await catalog.messages(identity))?.messages ?? []; }
    catch (error) {
      console.error(`[oyster] cannot read session ${sessionId} for title: ${error.message}`);
      return;
    } finally {
      if (runner.titleLoadingSessionId === sessionId) runner.titleLoadingSessionId = null;
    }
    if (!messages.length || runner.sessionId !== sessionId) return;

    const originalName = runner.sessionName ?? null;
    runner.titleSessionId = sessionId;
    Promise.resolve(summarizeTitle(state.piProcesses, {
      cwd: runner.dir,
      messages: messages.slice(0, SESSION_TITLE_MESSAGE_LIMIT),
      model: sessionState.model ?? null,
      onSpawn: (proc) => { runner.titleProcess = proc; },
    })).then(async (title) => {
      if (!title || runner.sessionId !== sessionId || (runner.sessionName ?? null) !== originalName) return;
      const name = originalName ? `\u23EA ${title}` : title;
      if (!sendToRunner(runner, { id: srvId(), type: "set_session_name", name }, { autostart: false })) return;
      runner.sessionName = name;
      await runnerRepository?.update(runner.id, { session_name: name });
      runnersChanged(runner);
    }).catch((error) => {
      console.error(`[oyster] cannot title session ${sessionId}: ${error.message}`);
    }).finally(() => {
      if (runner.titleSessionId === sessionId) runner.titleProcess = null;
    });
  }

  /** Apply a canonical driver event to runner lifecycle and session metadata. */
  async function trackRunner(runner, msg) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
    try { notifyRunnerEvent(runner, msg); }
    catch (error) { console.error(`[oyster] cannot notify for runner ${runner.id}: ${error?.message ?? error}`); }
    if (msg.type === "extension_ui_request") {
      if (msg.id) runner.pendingExtensionUiRequestIds.add(msg.id);
      if (CLARIFICATION_METHODS.has(msg.method)) setRunnerAttention(runner, "clarification");
    }
    if (msg.type === "agent_start") { setRunnerAttention(runner, null, false); runner.busy = true; runnersChanged(runner); }
    else if (msg.type === "agent_end") { runner.busy = !!msg.willRetry; runnersChanged(runner); requestState(runner); }
    else if (msg.type === "agent_settled") {
      runner.busy = false;
      if (runner.attentionStatus !== "clarification") setRunnerAttention(runner, "completed");
      runnersChanged(runner);
      requestState(runner);
    }
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
        const extractedReference = driverFor(runner).sessionReference(d, runner.sessionRef ?? null);
        const nextReference = extractedReference ? sessionReferences.validate(extractedReference) : null;
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
          const owner = nextReference ? await ensureSessionOwner(nextReference) : null;
          await runnerRepository?.update(runner.id, {
            owner_id: owner?.id ?? null,
            session_backend: nextReference?.backend ?? null,
            session_id: nextReference?.id ?? null,
            session_storage_path: nextReference?.storagePath ?? null,
            session_name: runner.sessionName,
          });
        }
        runner.busy = !!(d.isStreaming || d.isCompacting);
        if (changed) runnersChanged(runner);
        void maybeTitleSession(runner, d);
      } else if (["switch_session", "new_session", "set_session_name"].includes(msg.command)) {
        requestState(runner);
      }
    }
  }

  function requestState(runner) {
    sendToRunner(runner, driverFor(runner).stateCommand(srvId()), { autostart: false });
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
      if (runner.proc) driverFor(runner).sendCommand(runner, runner.proc, obj);
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

  async function spawnRunner({ dir, harness = runnerDrivers.defaultId, sessionRef = null, autostart = true, initialArgs = [] }) {
    const selectedDriver = runnerDrivers.get(harness);
    const reference = sessionRef ? sessionReferences.validate(sessionRef) : null;
    if (reference && !selectedDriver.isSessionCompatible(reference)) {
      throw new Error(`session ${reference.id} is incompatible with harness ${harness}`);
    }
    const owner = reference ? await ensureSessionOwner(reference) : null;
    const id = allocateRunnerId();
    const createdAt = now();
    await runnerRepository?.create({
      id, ownerId: owner?.id ?? null, dir, harness,
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
      harness,
      sessionRef: reference,
      sessionFile: reference?.backend === "jsonl" ? reference.storagePath : null,
      sessionId: reference?.id ?? null,
      sessionName: null,
      startCount: 0,
      initialArgs: [...initialArgs],
    });
    state.runners.set(runner.id, runner);
    if (autostart) await startRunner(runner);
    return runner;
  }

  async function startRunner(runner) {
    if (runner.proc) return;
    const nowMs = Date.now();
    // crash-loop guard: if this runner died within 2s of spawning, wait
    if (nowMs - runner.lastSpawnAt < 2000 && runner.startCount > 0) {
      if (!runner.startTimer) {
        const timer = setTimer(guardCallback(() => {
          if (runner.startTimer !== timer) return;
          runner.startTimer = null;
          if (!runner.proc && state.runners.has(runner.id)) startRunner(runner);
        }), 2000);
        runner.startTimer = timer;
        timer.unref?.();
      }
      return;
    }
    runner.lastSpawnAt = nowMs;
    runner.startCount++;
    const startedAt = now();
    await runnerRepository?.update(runner.id, {
      desired_state: "running", last_status: "starting", start_count: runner.startCount, last_started_at: startedAt,
    });
    const initialArgs = Array.isArray(runner.initialArgs) ? runner.initialArgs : [];
    runner.initialArgs = [];
    const runnerDriver = driverFor(runner);
    let proc;
    try {
      const launched = runnerDriver.launch({
        runner,
        initialArgs,
        cwd: runner.dir,
        systemPrompt: PINNED_ARTIFACT_SYSTEM_PROMPT,
      });
      proc = launched?.process;
      if (!proc) throw new Error(`runner driver ${runnerDriver.id} did not return a process`);
      console.log(`[oyster] spawning runner ${runner.id} with ${runnerDriver.id}: ${launched.description ?? "process"} (cwd: ${runner.dir})`);
    } catch (error) {
      await runnerRepository?.update(runner.id, { last_status: "dead", last_stopped_at: now() });
      runnerEvent(runner, { type: "pi_error", error: error?.message ?? String(error) });
      runnersChanged(runner);
      return;
    }
    runner.proc = proc;
    let launchFailed = false;
    let rl = null;

    // Node reports executable and cwd failures asynchronously. Register the
    // special `error` listener before the first await: an unhandled ChildProcess
    // error terminates the entire Oyster server instead of only this runner.
    proc.on("error", (err) => {
      launchFailed = true;
      console.error(`[oyster] failed to spawn runner ${runner.id}: ${err.message}`);
      runnerEvent(runner, { type: "pi_error", error: err.message });
      if (runner.proc === proc) { runner.proc = null; runner.driverEmit = null; }
      if (runner.stdoutReader === rl) {
        rl?.close();
        runner.stdoutReader = null;
      }
      Promise.resolve(runnerRepository?.update(runner.id, { last_status: "dead" }))
        .catch((error) => console.error(`[oyster] cannot persist failed runner ${runner.id}: ${error?.message ?? error}`));
      runnersChanged(runner);
    });

    // A successfully spawned child can also exit while persistence is yielding.
    // Attach this listener before awaiting for the same reason, even though an
    // unobserved `exit` event is not process-fatal.
    proc.on("exit", async (code, signal) => {
      console.log(`[oyster] runner ${runner.id} exited (code=${code}, signal=${signal})`);
      if (runner.proc === proc) {
        runner.proc = null;
        runner.driverEmit = null;
        if (runner.stdoutReader === rl) {
          rl?.close();
          runner.stdoutReader = null;
        }
        runner.busy = false;
        await runnerRepository?.update(runner.id, { last_status: "dead", last_stopped_at: now() });
        runnerEvent(runner, { type: "pi_exit", code, signal });
        runnersChanged(runner);
      }
    });

    await runnerRepository?.update(runner.id, { last_status: "running" });
    if (launchFailed || runner.proc !== proc) return;

    // health watchdog bookkeeping: only procs started by watchdog-aware
    // code update lastLineAt, so only those are probed (watchdogOk)
    runner.watchdogOk = true;
    runner.lastLineAt = Date.now();
    runner.probeSentAt = null;
    runner.probeMisses = 0;

    const emitDriverEvent = (event) => {
      if (runner.proc !== proc || !event || typeof event !== "object") return;
      try { trackRunner(runner, event); }
      catch (error) { console.error(`[oyster] cannot track runner ${runner.id} output: ${error?.message ?? error}`); }
      runnerWrite(runner, JSON.stringify(event));
    };
    runner.driverEmit = emitDriverEvent;
    rl = createInterface({ input: proc.stdout });
    runner.stdoutReader = rl;
    rl.on("line", (line) => {
      if (runner.proc !== proc) return;
      line = line.trim();
      if (!line) return;
      runner.lastLineAt = Date.now();
      let events;
      try { events = runnerDriver.decodeLine(runner, line); }
      catch (error) {
        console.error(`[oyster] runner driver ${runnerDriver.id} cannot decode output for ${runner.id}: ${error?.message ?? error}`);
        return;
      }
      if (!Array.isArray(events)) events = events ? [events] : [];
      for (const event of events) emitDriverEvent(event);
    });

    proc.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) console.error(`[${runnerDriver.id} ${runner.id} stderr] ${text}`);
    });

    const startupRequestId = srvId();
    const startup = runnerDriver.startup({ runner, requestId: startupRequestId }) ?? {};
    runner.resumeId = startup.resumeResponseId ?? null;
    for (const command of startup.commands ?? []) runnerDriver.sendCommand(runner, proc, command);
    if (runner.resumeId) {
      // Safety valve: never hold commands forever if a driver's resume response goes missing.
      clearTimeout(runner.resumeTimer);
      runner.resumeTimer = setTimeout(() => finishResume(runner), 15000);
      runner.resumeTimer.unref?.();
    }
    // Publish alive=true before pi_started. Clients use the start event to
    // request authoritative state, so delivering it first would leave a race
    // where their liveness guard still sees this runner as dormant.
    runnersChanged(runner);
    runnerEvent(runner, { type: "pi_started", startCount: runner.startCount });
  }

  async function stopRunner(runner) {
    const proc = runner.proc;
    await runnerRepository?.update(runner.id, { desired_state: "stopped", last_status: "stopped", last_stopped_at: now() });
    try { runner.titleProcess?.kill("SIGTERM"); } catch {}
    runner.titleProcess = null;
    clearTimer(runner.startTimer);
    runner.startTimer = null;
    if (!proc) return;
    runner.proc = null;
    runner.driverEmit = null;
    runner.busy = false;
    clearTimeout(runner.resumeTimer);
    runner.resumeTimer = null;
    runner.resumeId = null;
    runner.resumeQueue = [];
    const stdoutReader = runner.stdoutReader;
    proc.removeAllListeners("exit");
    proc.on("exit", () => {
      if (runner.stdoutReader === stdoutReader) {
        stdoutReader?.close();
        runner.stdoutReader = null;
      }
      // A replacement may already be running when the old process reports
      // its exit. Do not clobber its reader or publish a stale death event.
      if (!runner.proc) runnerEvent(runner, { type: "pi_exit", code: null, signal: "SIGTERM" });
    });
    try { proc.kill("SIGTERM"); }
    catch (error) { console.error(`[oyster] cannot stop runner ${runner.id}: ${error?.message ?? error}`); }
    const killTimer = setTimer(guardCallback(() => {
      // ChildProcess.killed only means that kill() was called; it does not
      // mean the child exited. Escalate every process still lacking an exit.
      if (proc.exitCode === null) {
        try { proc.kill("SIGKILL"); }
        catch (error) { console.error(`[oyster] cannot kill runner ${runner.id}: ${error?.message ?? error}`); }
      }
    }), 3000);
    killTimer.unref?.();
    runnersChanged(runner);
  }

  async function unarchivePromptedSession(runner) {
    if (!runner.sessionRef || (state.sessionCatalog?.backend && runner.sessionRef.backend !== state.sessionCatalog.backend)) return;
    if (unarchiveSession) {
      await unarchiveSession(runner.sessionRef);
      return;
    }
    const repository = appStore?.repositories?.sessions;
    const owner = await repository?.find({
      backend: runner.sessionRef.backend,
      sessionId: runner.sessionRef.id,
      storagePath: runner.sessionRef.storagePath ?? null,
    });
    if (owner?.archived) await repository.setArchived(owner.id, false);
  }

  async function sendToRunner(runner, obj, { autostart = true } = {}) {
    if (!runner.proc && autostart) await startRunner(runner);
    if (!runner.proc) return false;
    if (runner.resumeId) {
      // a session resume is in flight; deliver after it completes
      (runner.resumeQueue ??= []).push(obj);
    } else if (!driverFor(runner).sendCommand(runner, runner.proc, obj)) {
      return false;
    }
    if (obj.type === "prompt") {
      setRunnerAttention(runner, null, false);
      await unarchivePromptedSession(runner);
    } else if (obj.type === "extension_ui_response") {
      if (obj.id) runner.pendingExtensionUiRequestIds.delete(obj.id);
      setRunnerAttention(runner, null, false);
    }
    return true;
  }

  /** the runner new/unspecified clients get; created on demand */
  async function defaultRunner() {
    let r = state.runners.get(state.defaultRunnerId);
    if (!r) {
      const compatible = [...state.runners.values()].filter(compatibleWithConfiguredBackend);
      r = compatible.find((x) => x.proc) ?? compatible[0];
      if (!r) r = await spawnRunner({ dir: state.currentDir });
      state.defaultRunnerId = r.id;
      await runnerRepository?.setDefault(r.id);
      await state.appSettings?.setDefaultRunnerId(r.id);
    }
    return r;
  }

  async function runnerFromReq(url) {
    const id = url.searchParams.get("runner");
    const requested = id ? state.runners.get(id) : null;
    return (requested && compatibleWithConfiguredBackend(requested)) ? requested : await defaultRunner();
  }

  /** Reuse the runner attached to the full session identity, else spawn one. */
  async function openSessionRunner({ harness = null, sessionRef = null, sessionPath = null, sessionId = null, dir = null }) {
    const inputReference = sessionRef ?? (sessionPath && sessionId
      ? { backend: "jsonl", id: sessionId, storagePath: sessionPath }
      : null);
    const reference = inputReference ? sessionReferences.validate(inputReference) : null;
    const selectedHarness = harness ?? (reference ? runnerDrivers.compatible(reference)?.id : runnerDrivers.defaultId);
    if (!selectedHarness) throw new Error(`no harness can open session ${reference?.id ?? "unknown"}`);
    if (reference) {
      for (const r of state.runners.values()) {
        if (r.sessionRef && sessionReferences.equals(r.sessionRef, reference)) return r;
      }
    }
    // Brand-new sessions need the driver to establish their durable identity.
    // Saved sessions already have an identity and can remain dormant while read.
    return spawnRunner({ dir: dir || state.currentDir, harness: selectedHarness, sessionRef: reference, autostart: !reference });
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
            reason: `${driverFor(runner).label ?? runner.harness} did not answer health probes`, action: "restart",
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
      if (runner.busy) continue; // never interrupt active work
      // lastLineAt measures recent output, not process age. A noisy nameless
      // worker is still an orphan, so age it from the actual spawn time.
      if (now - runner.lastSpawnAt <= MAX_ORPHAN_AGE_MS) continue;
      console.log(
        `[oyster] reaping orphan runner ${runner.id} (alive ${Math.round((now - runner.lastSpawnAt) / 60000)}min, no session name) in ${runner.dir}`
      );
      stopRunner(runner);
    }
  }

  clearInterval(state.runnerReaperTimer);
  state.runnerReaperTimer = setInterval(guardCallback(reaperTick), ORPHAN_REAP_INTERVAL_MS);
  state.runnerReaperTimer.unref?.();

  // Startup and read-only session selection only restore descriptors. A command
  // that requests work starts the selected process.
  function startDrivers() {}
  async function stopDrivers() { await Promise.all([...state.runners.values()].map((runner) => stopRunner(runner))); }
  // Stable application lifecycle aliases retained for API compatibility.
  const startPi = startDrivers;
  const stopPi = stopDrivers;

  return {
    srvId, runnerInfo, listRunnerInfo, replayRunnerEvents, runnersChanged,
    spawnRunner, startRunner, stopRunner, sendToRunner, observeRunner, acknowledgeRunnerAttention,
    defaultRunner, runnerFromReq, openSessionRunner,
    startDrivers, stopDrivers, startPi, stopPi,
    runnerDriver: runnerDrivers.get(runnerDrivers.defaultId), runnerDrivers,
  };
}
