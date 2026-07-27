/**
 * oyster — tunnel manager
 *
 * Spawns and tracks tunnel processes (cloudflared quick tunnels by default)
 * on behalf of the UI, so a session can deterministically expose a local
 * port to the internet.
 *
 * Durable hublot and process metadata lives in SQLite. The stable core keeps
 * only live ChildProcess handles in `state.hublotProcessHandles`, keyed by
 * persistent hublot_processes.id, so hot reloads retain runtime control.
 */

import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { accessSync, closeSync, constants, fstatSync, openSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection, createServer } from "node:net";
import { materializeHublotStartupScriptRecord } from "./persistence/hublotScriptMaterializer.mjs";
import { readProcessIdentity, verifyPersistedProcessIdentity } from "./persistence/processIdentity.mjs";

const URL_TIMEOUT_MS = 20_000;
const PUBLIC_READY_TIMEOUT_MS = 60_000;
const PUBLIC_READY_INTERVAL_MS = 1_000;
const PUBLIC_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** Client-safe view of a tunnel (no process handles). */
export function tunnelInfo(t) {
  const { proc, agentProc, ...info } = t;
  return info;
}

/** PIDs listening on a local TCP port (excluding this server). */
export function pidsOnPort(port) {
  try {
    const out = execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return out.split("\n")
      .map((s) => Number(s.trim()))
      .filter((p) => Number.isInteger(p) && p > 1 && p !== process.pid);
  } catch {
    return []; // lsof exits 1 when nothing listens
  }
}

function killPid(pid, signal = "SIGTERM") {
  try { process.kill(pid, signal); return true; } catch { return false; }
}

/** When a process started, from /proc (Linux). Null if unknown. */
function pidStartedAt(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // fields after the parenthesized comm (which can contain spaces):
    // index 19 here = starttime (22nd field overall), in clock ticks since boot
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const startTicks = Number(fields[19]);
    const btime = Number((readFileSync("/proc/stat", "utf8").match(/^btime (\d+)$/m) ?? [])[1]);
    if (!btime || !Number.isFinite(startTicks)) return null;
    return new Date((btime + startTicks / 100) * 1000); // USER_HZ = 100
  } catch {
    return null;
  }
}

function hublotProcessHandles(state) {
  if (!state.hublotProcessHandles) state.hublotProcessHandles = new Map();
  return state.hublotProcessHandles;
}

function registerHublotProcessHandle(state, processRow, proc) {
  if (processRow && proc) hublotProcessHandles(state).set(processRow.id, proc);
  return proc;
}

function removeHublotProcessHandle(state, processRow, proc) {
  if (processRow && hublotProcessHandles(state).get(processRow.id) === proc) hublotProcessHandles(state).delete(processRow.id);
}

function hublotRepository(state) {
  const repository = state.appStore?.repositories?.hublots;
  if (!repository) throw new Error("hublot repository is required");
  return repository;
}

export function persistHublotProcessIdentity(state, {
  hublotId, role, pid, status = "running", startedAt = new Date().toISOString(),
} = {}) {
  if (!Number.isInteger(pid) || pid < 2) return null;
  const existing = hublotRepository(state).listProcesses(hublotId)
    .find((process) => process.role === role && process.pid === pid && process.status === status && !process.ended_at);
  if (existing) return existing;
  const identity = readProcessIdentity(pid);
  return state.appStore.transaction((repositories) => repositories.hublots.upsertProcess({
    id: `${hublotId}:${role}:${pid}:${randomBytes(4).toString("hex")}`,
    hublotId, role, pid,
    processGroupId: identity.processGroupId,
    bootId: identity.bootId,
    procStartTicks: identity.procStartTicks,
    executable: identity.executable,
    commandSha256: identity.commandSha256,
    status, startedAt, observedAt: new Date().toISOString(),
  }));
}

export function updateHublotProcessMetadata(state, id, changes) {
  return state.appStore.transaction((repositories) => {
    const updated = repositories.hublots.updateProcess(id, changes);
    if (!updated) throw new Error(`no such hublot process: ${id}`);
    return repositories.hublots.findProcess(id);
  });
}

function finishPersistedProcess(state, processRow, { status = "ended", exitCode = null, signal = null } = {}) {
  if (!processRow || !hublotRepository(state).findProcess(processRow.id)) return;
  return updateHublotProcessMetadata(state, processRow.id, {
    status, observed_at: new Date().toISOString(), ended_at: new Date().toISOString(),
    exit_code: exitCode, signal,
  });
}

const HUBLOT_STATUSES = new Set(["opening", "open", "recovering", "closing", "closed", "failed", "interrupted"]);

/** Atomically persist observed state and its immutable lifecycle record. */
export function recordHublotTransition(state, id, status, {
  desiredState, publicUrl, lastError, openedAt, closedAt,
  at = new Date().toISOString(),
} = {}) {
  if (!HUBLOT_STATUSES.has(status)) throw new Error(`invalid hublot status: ${status}`);
  return state.appStore.transaction((repositories) => {
    const current = repositories.hublots.find(id);
    if (!current) throw new Error(`no such hublot: ${id}`);
    const desired = desiredState ?? current.desired_state;
    const changes = { status, desired_state: desired };
    if (publicUrl !== undefined) changes.public_url = publicUrl;
    if (lastError !== undefined) changes.last_error = lastError;
    if (openedAt !== undefined) changes.opened_at = openedAt;
    if (closedAt !== undefined) changes.closed_at = closedAt;
    repositories.hublots.update(id, changes);
    repositories.hublots.appendLifecycleEvent({
      hublotId: id, status, desiredState: desired,
      publicUrl: publicUrl === undefined ? current.public_url : publicUrl,
      error: lastError === undefined ? current.last_error : lastError,
      createdAt: at,
    });
    return repositories.hublots.find(id);
  });
}

export function rebindHublot(state, id, ownerId = null) {
  return state.appStore.transaction((repositories) => {
    if (!repositories.hublots.find(id)) throw new Error(`no such hublot: ${id}`);
    repositories.hublots.update(id, { owner_id: ownerId });
    return repositories.hublots.find(id);
  });
}

function confirmSpawnedTunnelProcess(state, processRow, proc) {
  if (proc.exitCode !== null || proc.killed) return false;
  let identity;
  try { identity = readProcessIdentity(processRow.pid); } catch { return false; }
  if (!processRow.boot_id || !processRow.proc_start_ticks
    || processRow.boot_id !== identity.bootId
    || String(processRow.proc_start_ticks) !== String(identity.procStartTicks)) return false;
  const refreshed = updateHublotProcessMetadata(state, processRow.id, {
    process_group_id: identity.processGroupId,
    boot_id: identity.bootId,
    proc_start_ticks: identity.procStartTicks,
    executable: identity.executable,
    command_sha256: identity.commandSha256,
    observed_at: new Date().toISOString(),
  });
  return verifyPersistedProcessIdentity(refreshed);
}

export function currentHublotTunnelProcessIsHealthy(state, id, { verifyIdentity = verifyPersistedProcessIdentity } = {}) {
  const current = hublotRepository(state).listProcesses(id)
    .filter((process) => process.role === "tunnel" && !process.ended_at && ["running", "starting"].includes(process.status))
    .at(-1);
  return !!current && verifyIdentity(current);
}

function persistedTunnelInfo(state, row) {
  const service = hublotRepository(state).listProcesses(row.id).find((process) => process.role === "service" && process.status === "running");
  const publishUrl = row.status === "open" && currentHublotTunnelProcessIsHealthy(state, row.id);
  return {
    id: row.id,
    port: row.port,
    label: row.label,
    sessionId: row.session_id ?? null,
    status: row.status,
    url: publishUrl ? row.public_url : null,
    workdir: row.workdir,
    createdAt: row.created_at,
    ...(service ? { servicePid: service.pid } : {}),
  };
}

export function listTunnels(state) {
  return hublotRepository(state).list()
    .filter((row) => row.status !== "closed")
    .map((row) => persistedTunnelInfo(state, row))
    .filter((tunnel) => tunnel.url || ["opening", "recovering"].includes(tunnel.status));
}

export function isLocalPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolvePromise(false));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolvePromise(true)));
  });
}

/** Allocate a free port without process-local counters, then reserve it transactionally. */
export async function allocateHublot(state, options = {}, {
  startPort = 3000,
  checkPort = isLocalPortAvailable,
} = {}) {
  for (let port = startPort; port <= 65535; port++) {
    const inUse = hublotRepository(state).list().some((row) => row.port === port && row.status !== "closed");
    if (inUse || !(await checkPort(port))) continue;
    try { return reserveHublot(state, { ...options, port }); }
    catch (error) {
      if (/unique constraint|already tunneled/i.test(error.message)) continue;
      throw error;
    }
  }
  throw new Error(`no free hublot port available from ${startPort}`);
}

/** Allocate durable identity and recovery configuration before any process starts. */
export function reserveHublot(state, {
  port, label = null, sessionId = null, ownerId = null, brief = null,
  serviceKind = "agent_managed",
} = {}) {
  port = Number(port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${port}`);
  for (const row of hublotRepository(state).list()) {
    if (row.port === port && row.status !== "closed") throw new Error(`port ${port} is already tunneled: ${row.public_url}`);
  }
  const id = randomBytes(6).toString("hex");
  const createdAt = new Date().toISOString();
  const scriptRoot = state.config.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const serviceStartScriptPath = serviceKind === "agent_managed"
    ? join(scriptRoot, "hublots", id, "start.sh")
    : null;
  return state.appStore.transaction((repositories) => {
    repositories.hublots.create({
      id, ownerId, port, label, brief, workdir: state.currentDir, serviceKind,
      serviceStartScriptPath, status: "opening", desiredState: "open", createdAt,
    });
    repositories.hublots.appendLifecycleEvent({
      hublotId: id, status: "opening", desiredState: "open", createdAt,
    });
    return repositories.hublots.find(id);
  });
}

function failOpeningHublot(state, id, error) {
  const row = hublotRepository(state).find(id);
  if (!row || !["opening", "recovering"].includes(row.status)) return;
  const message = error instanceof Error ? error.message : String(error);
  recordHublotTransition(state, id, "failed", { publicUrl: null, lastError: message });
}

/** Return true only when Cloudflare can route a public request to the origin. */
export async function publicHublotAnswers(url, {
  fetchImpl = fetch,
  timeoutMs = 2_500,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const target = new URL(url);
    target.searchParams.set("__oyster_hublot_health", randomBytes(6).toString("hex"));
    const response = await fetchImpl(target, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: { "cache-control": "no-cache" },
      signal: controller.signal,
    });
    try { await response.body?.cancel(); } catch {}
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Poll public reachability so callers remain pending behind their spinner. */
export async function waitForPublicHublot(url, {
  timeoutMs = PUBLIC_READY_TIMEOUT_MS,
  intervalMs = PUBLIC_READY_INTERVAL_MS,
  check = publicHublotAnswers,
  clock = () => Date.now(),
  sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)),
} = {}) {
  const deadline = clock() + timeoutMs;
  do {
    if (await check(url)) return true;
    const remaining = deadline - clock();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  } while (clock() < deadline);
  throw new Error(`public hublot did not become ready within ${timeoutMs / 1000}s: ${url}`);
}

/**
 * Spawn a tunnel for a local port. Resolves only after Cloudflare reports the
 * URL and a public health check confirms that it reaches the origin.
 */
export function openTunnel(state, { id, port, label = null, sessionId = null }, {
  spawnProcess = spawn,
  waitForPublic = waitForPublicHublot,
} = {}) {
  return new Promise((resolvePromise, reject) => {
    port = Number(port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      reject(new Error(`invalid port: ${port}`));
      return;
    }
    const reservation = id ? hublotRepository(state).find(id) : null;
    if (!reservation || !["opening", "recovering"].includes(reservation.status) || reservation.port !== port) {
      reject(new Error("hublot must be durably reserved or recovering before opening its tunnel"));
      return;
    }

    const servicePid = pidsOnPort(port)[0] ?? null;
    if (servicePid) persistHublotProcessIdentity(state, { hublotId: id, role: "service", pid: servicePid });

    const bin = state.config.TUNNEL_BIN;
    // --protocol http2: QUIC (UDP 7844) is blocked on many networks, which
    // makes cloudflared print a URL that never actually registers (error 1033)
    const args = ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate", "--protocol", "http2"];
    console.log(`[pi-ui] spawning tunnel: ${bin} ${args.join(" ")}`);
    const proc = spawnProcess(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const tunnelProcess = persistHublotProcessIdentity(state, { hublotId: id, role: "tunnel", pid: proc.pid });
    registerHublotProcessHandle(state, tunnelProcess, proc);

    const tunnel = {
      id, port, label, sessionId, url: null,
      workdir: reservation.workdir, createdAt: reservation.created_at, proc,
    };

    let settled = false;
    let checkingPublicUrl = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      const error = new Error(`tunnel did not report a URL within ${URL_TIMEOUT_MS / 1000}s`);
      failOpeningHublot(state, id, error);
      reject(error);
    }, URL_TIMEOUT_MS);

    // cloudflared prints the assigned URL on stderr
    let errTail = "";
    const onOutput = (chunk) => {
      const text = String(chunk);
      errTail = (errTail + text).slice(-2000);
      const m = text.match(PUBLIC_URL_RE);
      if (m && !settled && !checkingPublicUrl) {
        checkingPublicUrl = true;
        clearTimeout(timer);
        if (!confirmSpawnedTunnelProcess(state, tunnelProcess, proc)) {
          settled = true;
          if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
          const error = new Error("tunnel reported a URL before its persisted process identity could be confirmed healthy");
          failOpeningHublot(state, id, error);
          reject(error);
          return;
        }
        tunnel.url = m[0];
        console.log(`[pi-ui] tunnel URL assigned; waiting for public readiness: ${tunnel.url}`);
        const confirmPublicReadiness = state.config.SKIP_PUBLIC_HUBLOT_READINESS
          ? async () => true
          : waitForPublic;
        void confirmPublicReadiness(tunnel.url).then(() => {
          if (settled) return;
          settled = true;
          const openedAt = new Date().toISOString();
          const row = recordHublotTransition(state, id, "open", {
            desiredState: "open", publicUrl: tunnel.url, lastError: null, openedAt, at: openedAt,
          });
          console.log(`[pi-ui] tunnel ready: ${tunnel.url} -> localhost:${port}`);
          state.serverEvent({ type: "tunnel_opened", tunnel: persistedTunnelInfo(state, row) });
          resolvePromise(persistedTunnelInfo(state, row));
        }).catch((error) => {
          if (settled) return;
          settled = true;
          if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
          failOpeningHublot(state, id, error);
          reject(error);
        });
      }
    };
    proc.stderr.on("data", onOutput);
    proc.stdout.on("data", onOutput);

    proc.on("error", (err) => {
      removeHublotProcessHandle(state, tunnelProcess, proc);
      finishPersistedProcess(state, tunnelProcess, { status: "failed" });
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const error = new Error(
        err.code === "ENOENT"
          ? `tunnel binary "${bin}" not found — install cloudflared or set --tunnel-bin / TUNNEL_BIN`
          : `tunnel spawn failed: ${err.message}`
      );
      failOpeningHublot(state, id, error);
      reject(error);
    });

    proc.on("exit", (code, signal) => {
      removeHublotProcessHandle(state, tunnelProcess, proc);
      finishPersistedProcess(state, tunnelProcess, { exitCode: code, signal });
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const error = new Error(`tunnel exited before reporting a URL (code=${code}): ${errTail.trim().split("\n").pop() ?? ""}`);
        failOpeningHublot(state, id, error);
        reject(error);
        return;
      }
      const current = hublotRepository(state).find(tunnel.id);
      if (current && current.status !== "failed" && current.status !== "closed") {
        const manuallyClosed = current.desired_state === "closed";
        const closedAt = new Date().toISOString();
        recordHublotTransition(state, tunnel.id, manuallyClosed ? "closed" : "interrupted", {
          desiredState: current.desired_state, publicUrl: null, closedAt,
          lastError: manuallyClosed ? null : `tunnel exited (code=${code}, signal=${signal})`, at: closedAt,
        });
        console.log(`[pi-ui] tunnel closed: ${tunnel.url} (code=${code}, signal=${signal})`);
        state.serverEvent({ type: "tunnel_closed", tunnel: { ...tunnelInfo(tunnel), url: null } });
      }
    });
  });
}

/** Close one tunnel by id: kills the cloudflared process, the background
 *  agent (if still running), and whatever is serving the port. Returns its
 *  info, or null if unknown. */
export function closeTunnel(state, id) {
  const row = hublotRepository(state).find(id);
  if (!row || row.status === "closed") return null;
  const closedInfo = persistedTunnelInfo(state, row);
  recordHublotTransition(state, id, "closing", { desiredState: "closed", publicUrl: null, lastError: null });
  const processes = hublotRepository(state).listProcesses(id);
  const handles = hublotProcessHandles(state);

  // 1. the service on the port: a discovered replacement is killed only when
  // it started after this hublot, preserving the legacy unrelated-listener guard.
  const trackedServicePids = processes.filter((process) => process.role === "service" && !process.ended_at).map((process) => process.pid);
  const createdAt = new Date(row.created_at).getTime() - 5000;
  for (const pid of new Set([...trackedServicePids, ...pidsOnPort(row.port)])) {
    if (!trackedServicePids.includes(pid)) {
      const started = pidStartedAt(pid);
      if (!started || started.getTime() < createdAt) {
        console.log(`[pi-ui] NOT killing pid ${pid} on port ${row.port} (predates the hublot)`);
        continue;
      }
    }
    if (killPid(pid)) console.log(`[pi-ui] killed hublot service pid ${pid} (port ${row.port})`);
    setTimeout(() => killPid(pid, "SIGKILL"), 3000).unref();
  }

  // 2. stop setup agents by their persistent process ids.
  for (const processRow of processes.filter((process) => process.role === "setup_agent")) {
    const agent = handles.get(processRow.id);
    if (!agent || agent.exitCode !== null || agent.killed) continue;
    agent.kill("SIGTERM");
    setTimeout(() => { if (agent.exitCode === null && !agent.killed) agent.kill("SIGKILL"); }, 3000).unref();
  }

  // 3. stop cloudflared handles; their exit callbacks finalize the row.
  let hasTunnelHandle = false;
  for (const processRow of processes.filter((process) => process.role === "tunnel")) {
    const tunnel = handles.get(processRow.id);
    if (!tunnel || tunnel.exitCode !== null) continue;
    hasTunnelHandle = true;
    tunnel.kill("SIGTERM");
    setTimeout(() => { if (tunnel.exitCode === null && !tunnel.killed) tunnel.kill("SIGKILL"); }, 3000).unref();
  }
  if (!hasTunnelHandle) {
    const closedAt = new Date().toISOString();
    recordHublotTransition(state, id, "closed", { desiredState: "closed", publicUrl: null, closedAt, at: closedAt });
  }
  return closedInfo;
}

/** Legacy/manual bulk close: changes desired state to closed. */
export function closeAllTunnels(state) {
  for (const row of hublotRepository(state).list()) if (row.status !== "closed") closeTunnel(state, row.id);
}

/** Graceful server shutdown: stop owned processes and retire ephemeral quick tunnels. */
export async function shutdownHublots(state, {
  termTimeoutMs = 3_000,
  killTimeoutMs = 1_000,
  pollIntervalMs = 25,
  verifyIdentity = verifyPersistedProcessIdentity,
  signalProcess = (pid, signal) => process.kill(pid, signal),
  clock = () => Date.now(),
  sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)),
} = {}) {
  const repository = hublotRepository(state);
  const targets = [];
  for (const row of repository.list().filter((entry) => entry.desired_state === "open")) {
    const error = "server stopped; ephemeral cloudflared tunnels are not recreated automatically";
    if (row.status !== "closing" || row.public_url !== null || row.last_error !== error) {
      recordHublotTransition(state, row.id, "closing", {
        desiredState: "closed", publicUrl: null, lastError: error,
      });
    }
    for (const processRow of repository.listProcesses(row.id)) {
      if (processRow.ended_at || !["running", "starting"].includes(processRow.status)) continue;
      if (processRow.role === "service" && row.service_kind !== "agent_managed") continue;
      if (!verifyIdentity(processRow)) continue;
      targets.push(processRow);
    }
  }

  const live = () => targets.filter((processRow) => verifyIdentity(processRow));
  const signalAll = (signal) => {
    for (const processRow of live()) {
      try { signalProcess(processRow.pid, signal); } catch (error) { if (error?.code !== "ESRCH") throw error; }
    }
  };
  const awaitExit = async (timeoutMs) => {
    const deadline = clock() + timeoutMs;
    while (live().length && clock() < deadline) await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - clock())));
  };

  signalAll("SIGTERM");
  await awaitExit(termTimeoutMs);
  const escalated = live().length;
  if (escalated) {
    signalAll("SIGKILL");
    await awaitExit(killTimeoutMs);
  }
  const remaining = live();
  const stoppedAt = new Date().toISOString();
  for (const processRow of targets) {
    if (remaining.some((entry) => entry.id === processRow.id)) continue;
    if (repository.findProcess(processRow.id)?.ended_at) continue;
    updateHublotProcessMetadata(state, processRow.id, {
      status: "ended", observed_at: stoppedAt, ended_at: stoppedAt,
      signal: "shutdown", exit_code: null,
    });
    hublotProcessHandles(state).delete(processRow.id);
  }
  for (const row of repository.list().filter((entry) => entry.status === "closing" && entry.desired_state === "closed")) {
    recordHublotTransition(state, row.id, remaining.some((processRow) => processRow.hublot_id === row.id) ? "interrupted" : "closed", {
      desiredState: "closed", publicUrl: null, lastError: row.last_error,
      closedAt: stoppedAt, at: stoppedAt,
    });
  }
  return Object.freeze({ targeted: targets.length, escalated, remaining: remaining.length });
}

// ---------------------------------------------------------------- hublot agents

/** Stop every process owned by a session's hublots before their owner row cascades. */
export async function closeSessionHublots(state, sessionId, {
  termTimeoutMs = 3_000,
  killTimeoutMs = 1_000,
  pollIntervalMs = 25,
  verifyIdentity = verifyPersistedProcessIdentity,
  signalProcess = (pid, signal) => process.kill(pid, signal),
  removeFile = unlinkSync,
  clock = () => Date.now(),
  sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)),
} = {}) {
  const repository = hublotRepository(state);
  const rows = repository.list().filter((row) => row.session_id === sessionId);
  const targets = [];
  for (const row of rows) {
    if (row.status !== "closed") recordHublotTransition(state, row.id, "closing", { desiredState: "closed", publicUrl: null, lastError: null });
    for (const processRow of repository.listProcesses(row.id)) {
      if (!processRow.ended_at && ["running", "starting"].includes(processRow.status) && verifyIdentity(processRow)) targets.push(processRow);
    }
  }
  const live = () => targets.filter((processRow) => verifyIdentity(processRow));
  const signalAll = (signal) => {
    for (const processRow of live()) {
      try { signalProcess(processRow.pid, signal); } catch (error) { if (error?.code !== "ESRCH") throw error; }
    }
  };
  const awaitExit = async (timeoutMs) => {
    const deadline = clock() + timeoutMs;
    while (live().length && clock() < deadline) await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - clock())));
  };
  signalAll("SIGTERM");
  await awaitExit(termTimeoutMs);
  if (live().length) { signalAll("SIGKILL"); await awaitExit(killTimeoutMs); }
  const remaining = live();
  if (remaining.length) throw new Error(`could not stop ${remaining.length} hublot process(es) for session ${sessionId}`);
  const stoppedAt = new Date().toISOString();
  for (const processRow of targets) {
    if (!repository.findProcess(processRow.id)?.ended_at) updateHublotProcessMetadata(state, processRow.id, {
      status: "ended", observed_at: stoppedAt, ended_at: stoppedAt, signal: "session_deleted", exit_code: null,
    });
    hublotProcessHandles(state).delete(processRow.id);
  }
  for (const row of rows) {
    if (repository.find(row.id)?.status !== "closed") recordHublotTransition(state, row.id, "closed", {
      desiredState: "closed", publicUrl: null, lastError: null, closedAt: stoppedAt, at: stoppedAt,
    });
    if (row.service_start_script_path) {
      const scriptRoot = resolve(state.config.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "hublots");
      const scriptPath = resolve(row.service_start_script_path);
      if (!scriptPath.startsWith(`${scriptRoot}${sep}`)) throw new Error(`refusing to remove hublot startup script outside ${scriptRoot}`);
      try { removeFile(scriptPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
  }
  return rows.map((row) => row.port);
}

/** Restore the authoritative startup artifact before any app-owned invocation. */
export function materializeHublotStartupScript(state, id) {
  const record = hublotRepository(state).find(id);
  if (!record) throw new Error(`no such hublot: ${id}`);
  const agentDir = state.config.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  return materializeHublotStartupScriptRecord(record, { agentDir });
}

/** Invoke only the freshly verified/materialized SQLite-owned startup source. */
export function invokeHublotStartupScript(state, id, { spawnProcess = spawn } = {}) {
  recordHublotTransition(state, id, "recovering", { publicUrl: null, lastError: null });
  let materialized;
  let proc;
  try {
    materialized = materializeHublotStartupScript(state, id);
    const record = hublotRepository(state).find(id);
    proc = spawnProcess(materialized.path, [], {
      cwd: record.workdir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
  } catch (error) {
    recordHublotTransition(state, id, "failed", { publicUrl: null, lastError: error.message });
    throw error;
  }
  const processRow = persistHublotProcessIdentity(state, { hublotId: id, role: "setup_agent", pid: proc.pid, status: "starting" });
  registerHublotProcessHandle(state, processRow, proc);
  proc.once?.("error", () => { removeHublotProcessHandle(state, processRow, proc); finishPersistedProcess(state, processRow, { status: "failed" }); });
  proc.once?.("exit", (exitCode, signal) => { removeHublotProcessHandle(state, processRow, proc); finishPersistedProcess(state, processRow, { exitCode, signal }); });
  return { proc, process: processRow, ...materialized };
}

export function localPortAnswers(port, timeoutMs = 1500) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: "127.0.0.1", port, timeout: timeoutMs });
    socket.on("connect", () => { socket.destroy(); resolvePromise(true); });
    socket.on("error", () => resolvePromise(false));
    socket.on("timeout", () => { socket.destroy(); resolvePromise(false); });
  });
}

export async function waitForLocalPort(port, { timeoutMs = 20_000, intervalMs = 250, check = localPortAnswers } = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await check(port)) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  } while (Date.now() < deadline);
  throw new Error(`service did not answer on port ${port} within ${timeoutMs / 1000}s`);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function markdownReaderScriptPath() {
  return resolve(process.env.MARKDOWN_READER_SCRIPT
    ?? join(dirname(fileURLToPath(import.meta.url)), "..", "markdown-tool", "markdown-reader.mjs"));
}

function markdownStartupScript({ nodePath, rendererPath, markdownPath, port }) {
  const probe = `const net=require("node:net");const socket=net.createConnection({host:"127.0.0.1",port:Number(process.argv[1])});socket.setTimeout(1000);socket.once("connect",()=>{socket.destroy();process.exit(0)});const fail=()=>process.exit(1);socket.once("error",fail);socket.once("timeout",fail);`;
  return `#!/bin/sh\n# oyster: idempotent\n` +
    `if ${shellQuote(nodePath)} -e ${shellQuote(probe)} ${port}\nthen\n  exit 0\nfi\n` +
    `exec ${shellQuote(nodePath)} ${shellQuote(rendererPath)} ${shellQuote(markdownPath)} ${port}\n`;
}

/** Start the fixed Markdown reader directly, without asking a setup agent. */
export async function spawnMarkdownService(state, hublot, markdownPath, {
  rendererPath = markdownReaderScriptPath(),
  nodePath = process.execPath,
  spawnProcess = spawn,
  waitForPort = waitForLocalPort,
} = {}) {
  if (!isAbsolute(markdownPath)) throw new Error("Markdown path must be absolute");
  const source = statSync(markdownPath);
  if (!source.isFile()) throw new Error(`Markdown path is not a file: ${markdownPath}`);
  const renderer = statSync(rendererPath);
  if (!renderer.isFile()) throw new Error(`Markdown reader is not a file: ${rendererPath}`);
  accessSync(rendererPath, constants.R_OK);

  const row = hublotRepository(state).find(hublot.id);
  if (!row || row.service_kind !== "agent_managed") throw new Error("agent-managed hublot reservation is required");
  const startupSource = markdownStartupScript({ nodePath, rendererPath, markdownPath, port: hublot.port });
  const startupSha256 = createHash("sha256").update(startupSource).digest("hex");
  hublotRepository(state).update(row.id, {
    service_start_script: startupSource,
    service_start_script_sha256: startupSha256,
  });
  materializeHublotStartupScript(state, row.id);

  console.log(`[pi-ui] starting Markdown reader for ${markdownPath} on :${hublot.port}`);
  const serviceProc = spawnProcess(nodePath, [rendererPath, markdownPath, String(hublot.port)], {
    cwd: dirname(markdownPath),
    stdio: "ignore",
    detached: true,
  });
  let serviceProcess = null;
  let ready = false;
  const stopped = new Promise((_, reject) => {
    serviceProc.once("error", (error) => {
      removeHublotProcessHandle(state, serviceProcess, serviceProc);
      finishPersistedProcess(state, serviceProcess, { status: "failed" });
      if (!ready) reject(new Error(`failed to start Markdown reader: ${error.message}`));
    });
    serviceProc.once("exit", (exitCode, signal) => {
      removeHublotProcessHandle(state, serviceProcess, serviceProc);
      finishPersistedProcess(state, serviceProcess, { exitCode, signal });
      if (!ready) reject(new Error(`Markdown reader exited before serving port ${hublot.port} (code=${exitCode})`));
    });
  });

  try {
    await Promise.race([waitForPort(hublot.port), stopped]);
    if (serviceProc.exitCode !== null) {
      throw new Error(`Markdown reader exited before serving port ${hublot.port} (code=${serviceProc.exitCode})`);
    }
    serviceProcess = persistHublotProcessIdentity(state, {
      hublotId: hublot.id, role: "service", pid: serviceProc.pid, status: "running",
    });
    if (!serviceProcess) throw new Error("Markdown reader started without a persistent process identity");
    registerHublotProcessHandle(state, serviceProcess, serviceProc);
    ready = true;
    serviceProc.unref();
    return { servicePid: serviceProc.pid, serviceProc, serviceProcess };
  } catch (error) {
    if (serviceProc.exitCode === null) serviceProc.kill("SIGTERM");
    throw error;
  }
}

export function gitSmartHttpServerScriptPath() {
  return resolve(process.env.GIT_SMART_HTTP_SERVER_SCRIPT
    ?? join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "serve-git-smart-http.sh"));
}

function gitServerStartupScript({ serverPath, worktreePath, stateDir, port }) {
  return `#!/bin/sh\n# oyster: idempotent\n` +
    `if python3 - ${port} <<'PY'\n` +
    `import socket, sys\n` +
    `try:\n` +
    `    with socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=1): pass\n` +
    `except OSError:\n` +
    `    raise SystemExit(1)\n` +
    `PY\nthen\n  exit 0\nfi\n` +
    `exec ${shellQuote(serverPath)} --host 127.0.0.1 --port ${port} --state-dir ${shellQuote(stateDir)} ${shellQuote(worktreePath)}\n`;
}

/** Start the fixed read-only Git Smart HTTP server without a setup agent. */
export async function spawnGitServerService(state, hublot, worktreePath, {
  serverPath = gitSmartHttpServerScriptPath(),
  spawnProcess = spawn,
  waitForPort = waitForLocalPort,
} = {}) {
  if (!isAbsolute(worktreePath)) throw new Error("Git worktree path must be absolute");
  const worktree = statSync(worktreePath);
  if (!worktree.isDirectory()) throw new Error(`Git worktree path is not a directory: ${worktreePath}`);
  try { execFileSync("git", ["-C", worktreePath, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore" }); }
  catch { throw new Error(`Git worktree path is not a Git worktree: ${worktreePath}`); }
  const server = statSync(serverPath);
  if (!server.isFile()) throw new Error(`Git Smart HTTP server is not a file: ${serverPath}`);
  accessSync(serverPath, constants.X_OK);

  const row = hublotRepository(state).find(hublot.id);
  if (!row || row.service_kind !== "agent_managed") throw new Error("agent-managed hublot reservation is required");
  const stateDir = join(dirname(row.service_start_script_path), "git-server-state");
  const startupSource = gitServerStartupScript({ serverPath, worktreePath, stateDir, port: hublot.port });
  const startupSha256 = createHash("sha256").update(startupSource).digest("hex");
  hublotRepository(state).update(row.id, {
    service_start_script: startupSource,
    service_start_script_sha256: startupSha256,
  });
  materializeHublotStartupScript(state, row.id);

  console.log(`[pi-ui] starting read-only Git Smart HTTP server for ${worktreePath} on :${hublot.port}`);
  const serviceProc = spawnProcess(serverPath, ["--host", "127.0.0.1", "--port", String(hublot.port), "--state-dir", stateDir, worktreePath], {
    cwd: worktreePath,
    stdio: "ignore",
    detached: true,
  });
  let serviceProcess = null;
  let ready = false;
  const stopped = new Promise((_, reject) => {
    serviceProc.once("error", (error) => {
      removeHublotProcessHandle(state, serviceProcess, serviceProc);
      finishPersistedProcess(state, serviceProcess, { status: "failed" });
      if (!ready) reject(new Error(`failed to start Git Smart HTTP server: ${error.message}`));
    });
    serviceProc.once("exit", (exitCode, signal) => {
      removeHublotProcessHandle(state, serviceProcess, serviceProc);
      finishPersistedProcess(state, serviceProcess, { exitCode, signal });
      if (!ready) reject(new Error(`Git Smart HTTP server exited before serving port ${hublot.port} (code=${exitCode})`));
    });
  });

  try {
    await Promise.race([waitForPort(hublot.port), stopped]);
    if (serviceProc.exitCode !== null) throw new Error(`Git Smart HTTP server exited before serving port ${hublot.port} (code=${serviceProc.exitCode})`);
    serviceProcess = persistHublotProcessIdentity(state, {
      hublotId: hublot.id, role: "service", pid: serviceProc.pid, status: "running",
    });
    if (!serviceProcess) throw new Error("Git Smart HTTP server started without a persistent process identity");
    registerHublotProcessHandle(state, serviceProcess, serviceProc);
    ready = true;
    serviceProc.unref();
    return { servicePid: serviceProc.pid, serviceProc, serviceProcess };
  } catch (error) {
    if (serviceProc.exitCode === null) serviceProc.kill("SIGTERM");
    throw error;
  }
}

/** Restart an agent-managed service and persist its replacement before tunneling. */
export async function recoverAnsweringHublotService(state, hublot, {
  checkPort = localPortAnswers,
  discoverPids = pidsOnPort,
  persistProcess = persistHublotProcessIdentity,
  reopenTunnel = openTunnel,
} = {}) {
  const current = hublotRepository(state).find(hublot.id);
  if (!current || current.desired_state !== "open") throw new Error(`hublot ${hublot.id} is not desired open`);
  if (!(await checkPort(current.port))) return Object.freeze({ recovered: false, answering: false, hublotId: current.id });
  if (current.status !== "recovering") recordHublotTransition(state, current.id, "recovering", { publicUrl: null, lastError: null });
  try {
    const servicePid = discoverPids(current.port)[0] ?? null;
    if (!servicePid) throw new Error(`answering service on port ${current.port} has no discoverable PID`);
    const serviceProcess = persistProcess(state, {
      hublotId: current.id, role: "service", pid: servicePid, status: "running",
    });
    const tunnel = await reopenTunnel(state, {
      id: current.id, port: current.port, label: current.label, sessionId: current.session_id,
    });
    return Object.freeze({ recovered: true, answering: true, hublotId: current.id, servicePid, serviceProcess, tunnel });
  } catch (error) {
    recordHublotTransition(state, current.id, "failed", { publicUrl: null, lastError: error.message });
    throw error;
  }
}

export async function restartHublotService(state, hublot, {
  invoke = invokeHublotStartupScript,
  waitForPort = waitForLocalPort,
  discoverPids = pidsOnPort,
  persistProcess = persistHublotProcessIdentity,
  reopenTunnel = openTunnel,
} = {}) {
  const current = hublotRepository(state).find(hublot.id);
  if (!current || current.desired_state !== "open" || current.service_kind !== "agent_managed") {
    throw new Error(`hublot ${hublot.id} is not a desired-open agent-managed service`);
  }
  try {
    invoke(state, current.id);
    await waitForPort(current.port);
    const servicePid = discoverPids(current.port)[0] ?? null;
    if (!servicePid) throw new Error(`service answers on port ${current.port} but its PID could not be discovered`);
    const serviceProcess = persistProcess(state, {
      hublotId: current.id, role: "service", pid: servicePid, status: "running",
    });
    const tunnel = await reopenTunnel(state, {
      id: current.id, port: current.port, label: current.label, sessionId: current.session_id,
    });
    return Object.freeze({ hublotId: current.id, servicePid, serviceProcess, tunnel });
  } catch (error) {
    recordHublotTransition(state, current.id, "failed", { publicUrl: null, lastError: error.message });
    throw error;
  }
}

const START_SCRIPT_MAX_BYTES = 256 * 1024;

export function hublotAgentPrompt(hublot, brief) {
  return `Prepare the following service on local port ${hublot.port}:\n${brief}\n\n` +
    `Create an idempotent executable startup script at exactly ${hublot.serviceStartScriptPath}. ` +
    `It must start with a shebang and the line "# oyster: idempotent", safely do nothing ` +
    `when the service is already healthy, and recreate the service after a restart. ` +
    `Invoke that exact script to start the service; do not start the service by any other command. ` +
    `Do not open a public tunnel. Whatever serves it must keep running after you exit. ` +
    `Verify it responds on port ${hublot.port} before finishing.`;
}

/** Validate the setup-agent artifact and atomically persist its recovery source. */
export function validateAndStoreHublotStartupScript(state, hublot) {
  const row = hublotRepository(state).find(hublot.id);
  const path = hublot.serviceStartScriptPath;
  if (!row || row.service_kind !== "agent_managed") throw new Error("agent-managed hublot reservation is required");
  if (!path || path !== row.service_start_script_path) throw new Error("setup agent did not use the allocated startup-script path");
  let descriptor = null;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error("startup script is not a regular file");
    if (!(metadata.mode & 0o111)) throw new Error("startup script is not executable");
    if (metadata.size < 1 || metadata.size > START_SCRIPT_MAX_BYTES) throw new Error(`startup script must be 1-${START_SCRIPT_MAX_BYTES} bytes`);
    const content = readFileSync(descriptor, "utf8");
    if (!content.startsWith("#!")) throw new Error("startup script must start with a shebang");
    if (!/^# oyster: idempotent$/m.test(content)) throw new Error("startup script must declare the idempotent hublot protocol");
    if (content.includes("\0")) throw new Error("startup script must be text");
    const sha256 = createHash("sha256").update(content).digest("hex");
    hublotRepository(state).update(row.id, {
      service_start_script: content,
      service_start_script_sha256: sha256,
    });
    return Object.freeze({ path, content, sha256 });
  } catch (error) {
    throw new Error(`invalid hublot startup script at ${path}: ${error.message}`, { cause: error });
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

/** Spawn a one-shot background pi agent (`pi -p`) and resolve only after
 *  its local service answers. The caller opens and publishes the tunnel
 *  afterwards, so users never see a hublot that still returns 502. */
export function spawnHublotAgent(state, hublot, brief) {
  return new Promise((resolvePromise, reject) => {
    const prompt = hublotAgentPrompt(hublot, brief);
    console.log(`[pi-ui] preparing local service for hublot :${hublot.port}`);
    // --no-session: these one-shot setup runs must not leave session files
    // behind (they would clutter the sessions list)
    const proc = state.piProcesses.ephemeral(["-p", prompt], {
      cwd: state.currentDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const agentProcess = persistHublotProcessIdentity(state, { hublotId: hublot.id, role: "setup_agent", pid: proc.pid });
    registerHublotProcessHandle(state, agentProcess, proc);
    let tail = "";
    const onOut = (chunk) => { tail = (tail + String(chunk)).slice(-1500); };
    proc.stdout.on("data", onOut);
    proc.stderr.on("data", onOut);

    let done = false;
    let agentExited = false;
    let agentExitAt = 0;
    const createdAt = new Date().toISOString();
    const started = Date.now();
    const timeoutMs = 5 * 60 * 1000;

    const checkPort = () => new Promise((resolveCheck) => {
      const socket = createConnection({ host: "127.0.0.1", port: hublot.port, timeout: 1500 });
      socket.on("connect", () => { socket.destroy(); resolveCheck(true); });
      socket.on("error", () => resolveCheck(false));
      socket.on("timeout", () => { socket.destroy(); resolveCheck(false); });
    });

    const finish = (error = null) => {
      if (done) return;
      if (!error) {
        try { validateAndStoreHublotStartupScript(state, hublot); }
        catch (validationError) { error = validationError.message; }
      }
      done = true;
      clearInterval(poll);
      if (error) {
        if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
        reject(new Error(error));
        return;
      }
      const servicePid = pidsOnPort(hublot.port)[0] ?? null;
      const serviceProcess = servicePid
        ? persistHublotProcessIdentity(state, { hublotId: hublot.id, role: "service", pid: servicePid, startedAt: createdAt })
        : null;
      if (servicePid) console.log(`[pi-ui] hublot :${hublot.port} served by pid ${servicePid}`);
      resolvePromise({ agentProc: proc, agentProcess, servicePid, serviceProcess, createdAt });
    };

    let checking = false;
    const poll = setInterval(async () => {
      if (done || checking) return;
      checking = true;
      const ready = await checkPort();
      checking = false;
      if (ready) {
        finish();
        return;
      }
      // Give a just-exited agent a short grace period: detached services can
      // take a moment to bind after the setup process exits.
      if (agentExited && Date.now() - agentExitAt > 10_000) {
        finish(`agent finished but nothing answers on port ${hublot.port}: ${tail.trim().split("\n").pop() ?? ""}`);
      } else if (Date.now() - started > timeoutMs) {
        finish("timed out waiting for the local hublot service to come up");
      }
    }, 2000);

    proc.on("exit", (code, signal) => {
      removeHublotProcessHandle(state, agentProcess, proc);
      finishPersistedProcess(state, agentProcess, { exitCode: code, signal });
      agentExited = true;
      agentExitAt = Date.now();
      console.log(`[pi-ui] hublot service agent for :${hublot.port} exited (code=${code})`);
    });
    proc.on("error", (error) => {
      removeHublotProcessHandle(state, agentProcess, proc);
      finishPersistedProcess(state, agentProcess, { status: "failed" });
      finish(`failed to spawn background agent: ${error.message}`);
    });
    proc.unref();
  });
}
