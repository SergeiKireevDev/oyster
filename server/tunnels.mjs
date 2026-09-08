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

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
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

function killPid(pid, signal = "SIGTERM") {
  try { process.kill(pid, signal); return true; } catch { return false; }
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

export async function persistHublotProcessIdentity(state, {
  hublotId, role, pid, status = "running", startedAt = new Date().toISOString(),
} = {}) {
  if (!Number.isInteger(pid) || pid < 2) return null;
  const existing = (await hublotRepository(state).listProcesses(hublotId))
    .find((process) => process.role === role && process.pid === pid && process.status === status && !process.ended_at);
  if (existing) return existing;
  const identity = readProcessIdentity(pid);
  return state.appStore.transaction(async (repositories) => await repositories.hublots.upsertProcess({
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

export async function updateHublotProcessMetadata(state, id, changes) {
  return state.appStore.transaction(async (repositories) => {
    const updated = await repositories.hublots.updateProcess(id, changes);
    if (!updated) throw new Error(`no such hublot process: ${id}`);
    return await repositories.hublots.findProcess(id);
  });
}

async function finishPersistedProcess(state, processRow, { status = "ended", exitCode = null, signal = null } = {}) {
  if (!processRow || !await hublotRepository(state).findProcess(processRow.id)) return;
  return await updateHublotProcessMetadata(state, processRow.id, {
    status, observed_at: new Date().toISOString(), ended_at: new Date().toISOString(),
    exit_code: exitCode, signal,
  });
}

const HUBLOT_STATUSES = new Set(["opening", "open", "recovering", "closing", "closed", "failed", "interrupted"]);

/** Atomically persist observed state and its immutable lifecycle record. */
export async function recordHublotTransition(state, id, status, {
  desiredState, publicUrl, lastError, openedAt, closedAt,
  at = new Date().toISOString(),
} = {}) {
  if (!HUBLOT_STATUSES.has(status)) throw new Error(`invalid hublot status: ${status}`);
  return state.appStore.transaction(async (repositories) => {
    const current = await repositories.hublots.find(id);
    if (!current) throw new Error(`no such hublot: ${id}`);
    const desired = desiredState ?? current.desired_state;
    const changes = { status, desired_state: desired };
    if (publicUrl !== undefined) changes.public_url = publicUrl;
    if (lastError !== undefined) changes.last_error = lastError;
    if (openedAt !== undefined) changes.opened_at = openedAt;
    if (closedAt !== undefined) changes.closed_at = closedAt;
    await repositories.hublots.update(id, changes);
    await repositories.hublots.appendLifecycleEvent({
      hublotId: id, status, desiredState: desired,
      publicUrl: publicUrl === undefined ? current.public_url : publicUrl,
      error: lastError === undefined ? current.last_error : lastError,
      createdAt: at,
    });
    return await repositories.hublots.find(id);
  });
}

export async function rebindHublot(state, id, ownerId = null) {
  return state.appStore.transaction(async (repositories) => {
    if (!await repositories.hublots.find(id)) throw new Error(`no such hublot: ${id}`);
    await repositories.hublots.update(id, { owner_id: ownerId });
    return await repositories.hublots.find(id);
  });
}

async function confirmSpawnedTunnelProcess(state, processRow, proc) {
  if (proc.exitCode !== null || proc.killed) return false;
  let identity;
  try { identity = readProcessIdentity(processRow.pid); } catch { return false; }
  if (!processRow.boot_id || !processRow.proc_start_ticks
    || processRow.boot_id !== identity.bootId
    || String(processRow.proc_start_ticks) !== String(identity.procStartTicks)) return false;
  const refreshed = await updateHublotProcessMetadata(state, processRow.id, {
    process_group_id: identity.processGroupId,
    boot_id: identity.bootId,
    proc_start_ticks: identity.procStartTicks,
    executable: identity.executable,
    command_sha256: identity.commandSha256,
    observed_at: new Date().toISOString(),
  });
  return verifyPersistedProcessIdentity(refreshed);
}

export async function currentHublotTunnelProcessIsHealthy(state, id, { verifyIdentity = verifyPersistedProcessIdentity } = {}) {
  const current = (await hublotRepository(state).listProcesses(id))
    .filter((process) => process.role === "tunnel" && !process.ended_at && ["running", "starting"].includes(process.status))
    .at(-1);
  return !!current && verifyIdentity(current);
}

async function persistedTunnelInfo(state, row) {
  const publishUrl = row.status === "open" && await currentHublotTunnelProcessIsHealthy(state, row.id);
  return {
    id: row.id,
    port: row.port,
    label: row.label,
    sessionId: row.session_id ?? null,
    status: row.status,
    url: publishUrl ? row.public_url : null,
    workdir: row.workdir,
    createdAt: row.created_at,
  };
}

export async function listTunnels(state, filters = {}) {
  const rows = await hublotRepository(state).list({
    excludeStatus: "closed",
    ...(filters.id ? { id: filters.id } : {}),
    ...(filters.sessionId ? { sessionId: filters.sessionId } : {}),
  });
  const tunnels = await Promise.all(rows
    .filter((row) => row.status !== "closed")
    .map(async (row) => await persistedTunnelInfo(state, row)));
  return tunnels.filter((tunnel) => tunnel.url || ["opening", "recovering"].includes(tunnel.status));
}

/** Allocate durable identity and recovery configuration before any process starts. */
export async function reserveHublot(state, {
  port, label = null, sessionId = null, ownerId = null,
} = {}) {
  port = Number(port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${port}`);
  for (const row of await hublotRepository(state).list({ port, excludeStatus: "closed" })) {
    if (row.port === port && row.status !== "closed") throw new Error(`port ${port} is already tunneled: ${row.public_url}`);
  }
  const id = randomBytes(6).toString("hex");
  const createdAt = new Date().toISOString();
  return state.appStore.transaction(async (repositories) => {
    await repositories.hublots.create({
      id, ownerId, port, label, workdir: state.currentDir, serviceKind: "self_served", status: "opening", desiredState: "open", createdAt,
    });
    await repositories.hublots.appendLifecycleEvent({
      hublotId: id, status: "opening", desiredState: "open", createdAt,
    });
    return await repositories.hublots.find(id);
  });
}

async function failOpeningHublot(state, id, error) {
  const row = await hublotRepository(state).find(id);
  if (!row || !["opening", "recovering"].includes(row.status)) return;
  const message = error instanceof Error ? error.message : String(error);
  await recordHublotTransition(state, id, "failed", { publicUrl: null, lastError: message });
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
  emitOpenedEvent = true,
} = {}) {
  return new Promise(async (resolvePromise, reject) => {
    port = Number(port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      reject(new Error(`invalid port: ${port}`));
      return;
    }
    const reservation = id ? await hublotRepository(state).find(id) : null;
    if (!reservation || !["opening", "recovering"].includes(reservation.status) || reservation.port !== port) {
      reject(new Error("hublot must be durably reserved or recovering before opening its tunnel"));
      return;
    }

    const bin = state.config.TUNNEL_BIN;
    // --protocol http2: QUIC (UDP 7844) is blocked on many networks, which
    // makes cloudflared print a URL that never actually registers (error 1033)
    const args = ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate", "--protocol", "http2"];
    console.log(`[oyster] spawning tunnel: ${bin} ${args.join(" ")}`);
    let proc;
    try {
      proc = spawnProcess(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const failure = new Error(`tunnel spawn failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      await failOpeningHublot(state, id, failure);
      reject(failure);
      return;
    }
    let tunnelProcess;
    try {
      tunnelProcess = await persistHublotProcessIdentity(state, { hublotId: id, role: "tunnel", pid: proc.pid });
      if (!tunnelProcess) throw new Error("tunnel started without a persistent process identity");
      registerHublotProcessHandle(state, tunnelProcess, proc);
    } catch (error) {
      proc.once?.("error", () => {});
      if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
      const failure = new Error(`could not persist tunnel process identity: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      await failOpeningHublot(state, id, failure);
      reject(failure);
      return;
    }

    const tunnel = {
      id, port, label, sessionId, url: null,
      workdir: reservation.workdir, createdAt: reservation.created_at, proc,
    };

    let settled = false;
    let checkingPublicUrl = false;
    const timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      const error = new Error(`tunnel did not report a URL within ${URL_TIMEOUT_MS / 1000}s`);
      await failOpeningHublot(state, id, error);
      reject(error);
    }, URL_TIMEOUT_MS);

    // cloudflared prints the assigned URL on stderr
    let errTail = "";
    const onOutput = async (chunk) => {
      const text = String(chunk);
      errTail = (errTail + text).slice(-2000);
      // Stream chunks can split the assigned URL at any byte boundary.
      const m = errTail.match(PUBLIC_URL_RE);
      if (m && !settled && !checkingPublicUrl) {
        checkingPublicUrl = true;
        clearTimeout(timer);
        if (!await confirmSpawnedTunnelProcess(state, tunnelProcess, proc)) {
          settled = true;
          if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
          const error = new Error("tunnel reported a URL before its persisted process identity could be confirmed healthy");
          await failOpeningHublot(state, id, error);
          reject(error);
          return;
        }
        tunnel.url = m[0];
        console.log(`[oyster] tunnel URL assigned; waiting for public readiness: ${tunnel.url}`);
        const confirmPublicReadiness = state.config.SKIP_PUBLIC_HUBLOT_READINESS
          ? async () => true
          : waitForPublic;
        void confirmPublicReadiness(tunnel.url).then(async () => {
          if (settled) return;
          settled = true;
          const openedAt = new Date().toISOString();
          const row = await recordHublotTransition(state, id, "open", {
            desiredState: "open", publicUrl: tunnel.url, lastError: null, openedAt, at: openedAt,
          });
          console.log(`[oyster] tunnel ready: ${tunnel.url} -> localhost:${port}`);
          const info = await persistedTunnelInfo(state, row);
          if (emitOpenedEvent) state.serverEvent({ type: "tunnel_opened", tunnel: info });
          resolvePromise(info);
        }).catch(async (error) => {
          if (settled) return;
          settled = true;
          if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
          await failOpeningHublot(state, id, error);
          reject(error);
        });
      }
    };
    proc.stderr.on("data", onOutput);
    proc.stdout.on("data", onOutput);

    proc.on("error", async (err) => {
      removeHublotProcessHandle(state, tunnelProcess, proc);
      await finishPersistedProcess(state, tunnelProcess, { status: "failed" });
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const error = new Error(
        err.code === "ENOENT"
          ? `tunnel binary "${bin}" not found — install cloudflared or set --tunnel-bin / TUNNEL_BIN`
          : `tunnel spawn failed: ${err.message}`
      );
      await failOpeningHublot(state, id, error);
      reject(error);
    });

    proc.on("exit", async (code, signal) => {
      removeHublotProcessHandle(state, tunnelProcess, proc);
      await finishPersistedProcess(state, tunnelProcess, { exitCode: code, signal });
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const error = new Error(`tunnel exited before reporting a URL (code=${code}): ${errTail.trim().split("\n").pop() ?? ""}`);
        await failOpeningHublot(state, id, error);
        reject(error);
        return;
      }
      const current = await hublotRepository(state).find(tunnel.id);
      const latestTunnel = (await hublotRepository(state).listProcesses(tunnel.id))
        .filter((row) => row.role === "tunnel").at(-1);
      if (current && !state.hublotReopens?.has(tunnel.id) && latestTunnel?.id === tunnelProcess?.id && current.status !== "failed" && current.status !== "closed") {
        const manuallyClosed = current.desired_state === "closed";
        const closedAt = new Date().toISOString();
        await recordHublotTransition(state, tunnel.id, manuallyClosed ? "closed" : "interrupted", {
          desiredState: current.desired_state, publicUrl: null, closedAt,
          lastError: manuallyClosed ? null : `tunnel exited (code=${code}, signal=${signal})`, at: closedAt,
        });
        console.log(`[oyster] tunnel closed: ${tunnel.url} (code=${code}, signal=${signal})`);
        const latest = await hublotRepository(state).find(tunnel.id);
        if (latest) {
          state.serverEvent({ type: "tunnel_closed", tunnel: await persistedTunnelInfo(state, latest) });
        }
      }
    });
  });
}

/** Reopen the tunnel to its existing port without provisioning a service. */
export async function reopenHublot(state, id, {
  open = openTunnel,
} = {}) {
  const pending = state.hublotReopens ??= new Set();
  if (pending.has(id)) throw Object.assign(new Error("hublot is already reopening"), { statusCode: 409 });
  pending.add(id);
  let started = false;
  try {
    const row = await hublotRepository(state).find(id);
    if (!row) throw Object.assign(new Error("no such hublot"), { statusCode: 404 });
    if (["opening", "recovering", "closing"].includes(row.status)
      || (row.status === "open" && await currentHublotTunnelProcessIsHealthy(state, id))) {
      throw Object.assign(new Error("hublot is already active"), { statusCode: 409 });
    }
    const conflict = (await hublotRepository(state).list({ port: row.port }))
      .some((other) => other.id !== id && other.status !== "closed");
    if (conflict) throw Object.assign(new Error("hublot port is reserved by another hublot"), { statusCode: 409 });
    // Retire old tunnel identities before launching a replacement.
    for (const processRow of await hublotRepository(state).listProcesses(id)) {
      if (processRow.role !== "tunnel" || processRow.ended_at) continue;
      if (verifyPersistedProcessIdentity(processRow)) killPid(processRow.pid);
      await finishPersistedProcess(state, processRow);
    }
    await recordHublotTransition(state, id, "opening", {
      desiredState: "open", publicUrl: null, lastError: null, closedAt: null,
    });
    started = true;
    state.serverEvent?.({ type: "tunnel_opening", tunnel: await persistedTunnelInfo(state, await hublotRepository(state).find(id)) });
    const current = await hublotRepository(state).find(id);
    if (current.status !== "opening" || current.desired_state !== "open") throw new Error("hublot reopening was cancelled");
    return await open(state, { id, port: row.port, label: row.label, sessionId: row.session_id });
  } catch (error) {
    if (started) {
      await failOpeningHublot(state, id, error);
      state.serverEvent?.({ type: "hublot_failed", tunnel: { id, status: "failed", url: null }, error: error.message });
    }
    throw error;
  } finally {
    pending.delete(id);
  }
}

/** Close a tunnel by id, leaving the local service alone. */
export async function closeTunnel(state, id) {
  const row = await hublotRepository(state).find(id);
  if (!row || row.status === "closed") return null;
  const closedInfo = await persistedTunnelInfo(state, row);
  await recordHublotTransition(state, id, "closing", { desiredState: "closed", publicUrl: null, lastError: null });
  const processes = await hublotRepository(state).listProcesses(id);
  const handles = hublotProcessHandles(state);

  let hasTunnelHandle = false;
  for (const processRow of processes.filter((process) => process.role === "tunnel")) {
    const tunnel = handles.get(processRow.id);
    if (!tunnel || tunnel.exitCode !== null) continue;
    hasTunnelHandle = true;
    tunnel.kill("SIGTERM");
    setTimeout(() => { if (tunnel.exitCode === null) tunnel.kill("SIGKILL"); }, 3000).unref();
  }
  if (!hasTunnelHandle) {
    const closedAt = new Date().toISOString();
    await recordHublotTransition(state, id, "closed", { desiredState: "closed", publicUrl: null, closedAt, at: closedAt });
  }
  return closedInfo;
}

/** Legacy/manual bulk close: changes desired state to closed. */
export async function closeAllTunnels(state) {
  for (const row of await hublotRepository(state).list({ excludeStatus: "closed" })) await closeTunnel(state, row.id);
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
  for (const row of await repository.list({ desiredState: "open" })) {
    const error = "server stopped; ephemeral cloudflared tunnels are not recreated automatically";
    if (row.status !== "closing" || row.public_url !== null || row.last_error !== error) {
      await recordHublotTransition(state, row.id, "closing", {
        desiredState: "closed", publicUrl: null, lastError: error,
      });
    }
    for (const processRow of await repository.listProcesses(row.id)) {
      if (processRow.ended_at || !["running", "starting"].includes(processRow.status)) continue;
      if (processRow.role !== "tunnel") continue;
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
    if (await repository.findProcess(processRow.id)?.ended_at) continue;
    await updateHublotProcessMetadata(state, processRow.id, {
      status: "ended", observed_at: stoppedAt, ended_at: stoppedAt,
      signal: "shutdown", exit_code: null,
    });
    hublotProcessHandles(state).delete(processRow.id);
  }
  for (const row of await repository.list({ status: "closing", desiredState: "closed" })) {
    await recordHublotTransition(state, row.id, remaining.some((processRow) => processRow.hublot_id === row.id) ? "interrupted" : "closed", {
      desiredState: "closed", publicUrl: null, lastError: row.last_error,
      closedAt: stoppedAt, at: stoppedAt,
    });
  }
  return Object.freeze({ targeted: targets.length, escalated, remaining: remaining.length });
}

/** Stop a session's tunnels before their owner row cascades. */
export async function closeSessionHublots(state, sessionId, {
  termTimeoutMs = 3_000,
  killTimeoutMs = 1_000,
  pollIntervalMs = 25,
  verifyIdentity = verifyPersistedProcessIdentity,
  signalProcess = (pid, signal) => process.kill(pid, signal),
  clock = () => Date.now(),
  sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)),
} = {}) {
  const repository = hublotRepository(state);
  const rows = await repository.list({ sessionId });
  const targets = [];
  for (const row of rows) {
    if (row.status !== "closed") await recordHublotTransition(state, row.id, "closing", { desiredState: "closed", publicUrl: null, lastError: null });
    for (const processRow of await repository.listProcesses(row.id)) {
      if (processRow.role === "tunnel" && !processRow.ended_at && ["running", "starting"].includes(processRow.status) && verifyIdentity(processRow)) targets.push(processRow);
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
    if (!(await repository.findProcess(processRow.id))?.ended_at) await updateHublotProcessMetadata(state, processRow.id, {
      status: "ended", observed_at: stoppedAt, ended_at: stoppedAt, signal: "session_deleted", exit_code: null,
    });
    hublotProcessHandles(state).delete(processRow.id);
  }
  for (const row of rows) {
    if ((await repository.find(row.id))?.status !== "closed") await recordHublotTransition(state, row.id, "closed", {
      desiredState: "closed", publicUrl: null, lastError: null, closedAt: stoppedAt, at: stoppedAt,
    });
  }
  return rows.map((row) => row.port);
}
