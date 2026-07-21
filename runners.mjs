/**
 * pi-lot-ui — pi runner manager
 *
 * One pi process per open session ("runner"). Runners keep working in the
 * background when the browser looks at another session; each SSE client
 * subscribes to exactly one runner, and runner status (busy/idle/dead) is
 * broadcast to everyone so session lists can show live indicators.
 *
 * Live runners are kept in `state.runners` (a Map owned by the stable core's
 * state object) so they survive hot reloads of app.mjs. Each value:
 *   {
 *     id:          "r<n>"   – handle used by clients (?runner=id)
 *     dir:         string   – cwd the pi process runs in
 *     sessionFile: string?  – session .jsonl this runner is attached to
 *     sessionId:   string?  – its session id (from get_state)
 *     sessionName: string?  – its session name (from get_state)
 *     busy:        boolean  – streaming/compacting right now
 *     proc:        ChildProcess|null
 *     buffer:      string[] – recent stdout lines, replayed to new clients
 *     resumeId / resumeQueue / resumeTimer – in-flight session resume state
 *   }
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const RUNNER_BUFFER_MAX = 400;

export function createRunnerManager(state) {
  const { config, serverEvent } = state;

  if (!state.runners) state.runners = new Map(); // id -> runner
  if (!state.runnerSeq) state.runnerSeq = 0;

  // one-time migration from the single-process era: a pre-runner pi process
  // may survive a hot reload as state.pi; its stdout listeners belong to old
  // code, so retire it and let runners take over
  if (state.pi) {
    console.log("[pi-ui] retiring pre-runner pi process (multi-runner migration)");
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
      id: r.id, dir: r.dir, sessionFile: r.sessionFile, sessionId: r.sessionId,
      sessionName: r.sessionName, busy: r.busy, alive: !!r.proc,
    };
  }

  function listRunnerInfo() {
    return [...state.runners.values()].map(runnerInfo);
  }

  /** global (all-clients) notification that some runner changed state */
  function runnersChanged() {
    serverEvent({ type: "runners_update", runners: listRunnerInfo() });
  }

  /** deliver a line only to SSE clients subscribed to this runner */
  function runnerWrite(runner, line) {
    runner.buffer.push(line);
    if (runner.buffer.length > RUNNER_BUFFER_MAX) runner.buffer.shift();
    for (const res of state.sseClients) {
      if (res.runnerId === runner.id) res.write(`data: ${line}\n\n`);
    }
  }

  function runnerEvent(runner, obj) {
    runnerWrite(runner, JSON.stringify({ ...obj, _server: true, runner: runner.id }));
  }

  /** watch a runner's stdout to maintain busy/session metadata */
  function trackRunner(runner, line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type === "agent_start") { runner.busy = true; runnersChanged(); }
    else if (msg.type === "agent_end") { runner.busy = false; runnersChanged(); requestState(runner); }
    else if (msg.type === "response" && msg.id === runner.resumeId) {
      // session resume finished (success or not): deliver held-back commands
      finishResume(runner);
      if (msg.success) requestState(runner);
    }
    else if (msg.type === "response" && msg.success) {
      if (msg.command === "get_state" && msg.data) {
        const d = msg.data;
        const changed = runner.sessionFile !== d.sessionFile ||
          runner.sessionId !== d.sessionId || runner.sessionName !== d.sessionName;
        runner.sessionFile = d.sessionFile ?? runner.sessionFile;
        runner.sessionId = d.sessionId ?? runner.sessionId;
        runner.sessionName = d.sessionName ?? null;
        runner.busy = !!(d.isStreaming || d.isCompacting);
        if (changed) runnersChanged();
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
    const queued = runner.resumeQueue ?? [];
    runner.resumeQueue = [];
    for (const obj of queued) {
      if (runner.proc?.stdin.writable) runner.proc.stdin.write(JSON.stringify(obj) + "\n");
    }
  }

  function spawnRunner({ dir, sessionPath = null }) {
    const runner = {
      id: `r${++state.runnerSeq}`,
      dir,
      sessionFile: sessionPath,
      sessionId: null,
      sessionName: null,
      busy: false,
      proc: null,
      buffer: [],
      startCount: 0,
      lastSpawnAt: 0,
    };
    state.runners.set(runner.id, runner);
    startRunner(runner);
    return runner;
  }

  function startRunner(runner) {
    if (runner.proc) return;
    const now = Date.now();
    // crash-loop guard: if this runner died within 2s of spawning, wait
    if (now - runner.lastSpawnAt < 2000 && runner.startCount > 0) {
      setTimeout(() => { if (!runner.proc && state.runners.has(runner.id)) startRunner(runner); }, 2000);
      return;
    }
    runner.lastSpawnAt = now;
    runner.startCount++;
    const args = ["--mode", "rpc", ...config.PI_EXTRA_ARGS];
    console.log(`[pi-ui] spawning runner ${runner.id}: ${config.PI_BIN} ${args.join(" ")} (cwd: ${runner.dir})`);
    const proc = spawn(config.PI_BIN, args, { cwd: runner.dir, stdio: ["pipe", "pipe", "pipe"] });
    runner.proc = proc;

    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      line = line.trim();
      if (!line) return;
      trackRunner(runner, line);
      runnerWrite(runner, line);
    });

    proc.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) console.error(`[pi ${runner.id} stderr] ${text}`);
    });

    proc.on("error", (err) => {
      console.error(`[pi-ui] failed to spawn runner ${runner.id}: ${err.message}`);
      runnerEvent(runner, { type: "pi_error", error: err.message });
      if (runner.proc === proc) runner.proc = null;
      runnersChanged();
    });

    proc.on("exit", (code, signal) => {
      console.log(`[pi-ui] runner ${runner.id} exited (code=${code}, signal=${signal})`);
      if (runner.proc === proc) {
        runner.proc = null;
        runner.busy = false;
        runnerEvent(runner, { type: "pi_exit", code, signal });
        runnersChanged();
      }
    });

    // resume the runner's session after a restart (fresh runners with a
    // requested sessionPath also land here). pi handles a prompt arriving
    // right behind switch_session concurrently, and the switch then discards
    // the run — so hold every other command back until the resume completes.
    if (runner.sessionFile) {
      runner.resumeId = srvId();
      proc.stdin.write(JSON.stringify({ id: runner.resumeId, type: "switch_session", sessionPath: runner.sessionFile }) + "\n");
      // safety valve: never hold commands forever if the response goes missing
      clearTimeout(runner.resumeTimer);
      runner.resumeTimer = setTimeout(() => finishResume(runner), 15000);
      runner.resumeTimer.unref?.();
    } else {
      requestState(runner);
    }
    runnerEvent(runner, { type: "pi_started", startCount: runner.startCount });
    runnersChanged();
  }

  function stopRunner(runner) {
    const proc = runner.proc;
    if (!proc) return;
    runner.proc = null;
    runner.busy = false;
    proc.removeAllListeners("exit");
    proc.on("exit", () => runnerEvent(runner, { type: "pi_exit", code: null, signal: "SIGTERM" }));
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) proc.kill("SIGKILL");
    }, 3000).unref();
    runnersChanged();
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
      r = [...state.runners.values()].find((x) => x.proc) ?? [...state.runners.values()][0];
      if (!r) r = spawnRunner({ dir: state.currentDir });
      state.defaultRunnerId = r.id;
    }
    return r;
  }

  function runnerFromReq(url) {
    const id = url.searchParams.get("runner");
    return (id && state.runners.get(id)) || defaultRunner();
  }

  /** reuse the runner already attached to a session file, else spawn one */
  function openSessionRunner({ sessionPath = null, dir = null }) {
    if (sessionPath) {
      for (const r of state.runners.values()) {
        if (r.sessionFile === sessionPath) {
          if (!r.proc) startRunner(r);
          return r;
        }
      }
    }
    return spawnRunner({ dir: dir || state.currentDir, sessionPath });
  }

  // legacy entry points used by server.mjs
  function startPi() { defaultRunner(); }
  function stopPi() { for (const r of state.runners.values()) stopRunner(r); }

  return {
    srvId, runnerInfo, listRunnerInfo, runnersChanged,
    spawnRunner, startRunner, stopRunner, sendToRunner,
    defaultRunner, runnerFromReq, openSessionRunner,
    startPi, stopPi,
  };
}
