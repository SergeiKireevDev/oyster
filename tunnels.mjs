/**
 * pi-lot-ui — tunnel manager
 *
 * Spawns and tracks tunnel processes (cloudflared quick tunnels by default)
 * on behalf of the UI, so a session can deterministically expose a local
 * port to the internet.
 *
 * Live tunnels are kept in `state.tunnels` (a Map owned by the stable core's
 * state object), so they survive hot reloads of app.mjs. Each value:
 *   {
 *     id:        string  – handle used by the UI to close the tunnel
 *     port:      number  – local port being exposed
 *     label:     string? – what the tunnel is for ("vite dev server", …)
 *     sessionId: string? – pi session the tunnel was opened in (binds it to
 *                          that session in the UI; null = unbound/legacy)
 *     url:       string  – public URL, known once the tunnel is up
 *     workdir:   string  – project active when the tunnel was created
 *     createdAt: string  – ISO timestamp
 *     proc:      ChildProcess (never serialized to clients)
 *     agentProc: ChildProcess? – background pi agent setting the port up
 *     servicePid: number? – pid listening on the port (killed on close)
 *   }
 */

import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";

const URL_TIMEOUT_MS = 20_000;
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

function hublotRepository(state) {
  const repository = state.appStore?.repositories?.hublots;
  if (!repository) throw new Error("hublot repository is required");
  return repository;
}

function persistedTunnelInfo(state, row) {
  const service = hublotRepository(state).listProcesses(row.id).find((process) => process.role === "service" && process.status === "running");
  return {
    id: row.id,
    port: row.port,
    label: row.label,
    sessionId: row.session_id ?? null,
    url: row.public_url,
    workdir: row.workdir,
    createdAt: row.created_at,
    ...(service ? { servicePid: service.pid } : {}),
  };
}

export function listTunnels(state) {
  return hublotRepository(state).list()
    .filter((row) => row.status !== "closed")
    .map((row) => persistedTunnelInfo(state, row));
}

/**
 * Spawn a tunnel for a local port. Resolves with the tunnel entry once the
 * public URL is known; rejects if the process dies or times out first.
 */
export function openTunnel(state, {
  port, label = null, sessionId = null, ownerId = null, brief = null,
  serviceKind = brief ? "agent_managed" : "self_served",
  createdAt = new Date().toISOString(),
}) {
  return new Promise((resolvePromise, reject) => {
    port = Number(port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      reject(new Error(`invalid port: ${port}`));
      return;
    }
    if (!state.tunnels) state.tunnels = new Map();
    for (const t of hublotRepository(state).list()) {
      if (t.port === port && t.status !== "closed") {
        reject(new Error(`port ${port} is already tunneled: ${t.public_url}`));
        return;
      }
    }

    const bin = state.config.TUNNEL_BIN;
    // --protocol http2: QUIC (UDP 7844) is blocked on many networks, which
    // makes cloudflared print a URL that never actually registers (error 1033)
    const args = ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate", "--protocol", "http2"];
    console.log(`[pi-ui] spawning tunnel: ${bin} ${args.join(" ")}`);
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });

    const tunnel = {
      id: randomBytes(6).toString("hex"), port, label, sessionId, ownerId, brief,
      serviceKind, url: null, workdir: state.currentDir, createdAt, proc,
    };

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      reject(new Error(`tunnel did not report a URL within ${URL_TIMEOUT_MS / 1000}s`));
    }, URL_TIMEOUT_MS);

    // cloudflared prints the assigned URL on stderr
    let errTail = "";
    const onOutput = (chunk) => {
      const text = String(chunk);
      errTail = (errTail + text).slice(-2000);
      const m = text.match(PUBLIC_URL_RE);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        tunnel.url = m[0];
        const row = hublotRepository(state).create({
          id: tunnel.id, ownerId, port, label, brief, workdir: tunnel.workdir,
          serviceKind, publicUrl: tunnel.url, status: "open", desiredState: "open",
          createdAt, openedAt: new Date().toISOString(),
        });
        hublotRepository(state).appendLifecycleEvent({
          hublotId: tunnel.id, status: "open", desiredState: "open",
          publicUrl: tunnel.url, createdAt: new Date().toISOString(),
        });
        state.tunnels.set(tunnel.id, tunnel);
        console.log(`[pi-ui] tunnel up: ${tunnel.url} -> localhost:${port}`);
        state.serverEvent({ type: "tunnel_opened", tunnel: persistedTunnelInfo(state, row) });
        resolvePromise(persistedTunnelInfo(state, row));
      }
    };
    proc.stderr.on("data", onOutput);
    proc.stdout.on("data", onOutput);

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(
        err.code === "ENOENT"
          ? `tunnel binary "${bin}" not found — install cloudflared or set --tunnel-bin / TUNNEL_BIN`
          : `tunnel spawn failed: ${err.message}`
      ));
    });

    proc.on("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`tunnel exited before reporting a URL (code=${code}): ${errTail.trim().split("\n").pop() ?? ""}`));
        return;
      }
      if (state.tunnels.delete(tunnel.id)) {
        const current = hublotRepository(state).find(tunnel.id);
        const manuallyClosed = current?.desired_state === "closed";
        hublotRepository(state).update(tunnel.id, {
          status: manuallyClosed ? "closed" : "interrupted",
          public_url: null,
          closed_at: new Date().toISOString(),
          last_error: manuallyClosed ? null : `tunnel exited (code=${code}, signal=${signal})`,
        });
        hublotRepository(state).appendLifecycleEvent({
          hublotId: tunnel.id, status: manuallyClosed ? "closed" : "interrupted",
          desiredState: current?.desired_state ?? "open", error: manuallyClosed ? null : `tunnel exited (code=${code}, signal=${signal})`,
          createdAt: new Date().toISOString(),
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
  hublotRepository(state).update(id, { desired_state: "closed", status: "closing", public_url: null, last_error: null });
  hublotRepository(state).appendLifecycleEvent({ hublotId: id, status: "closing", desiredState: "closed", createdAt: new Date().toISOString() });
  const t = state.tunnels?.get(id);
  if (!t) {
    hublotRepository(state).update(id, { status: "closed", closed_at: new Date().toISOString() });
    hublotRepository(state).appendLifecycleEvent({ hublotId: id, status: "closed", desiredState: "closed", createdAt: new Date().toISOString() });
    return closedInfo;
  }

  // 1. the service on the port: the tracked pid is killed unconditionally;
  //    the live port scan (service may have forked/respawned under another
  //    pid) only kills processes that STARTED AFTER the tunnel was created —
  //    an unrelated pre-existing listener must not die with the hublot
  const createdAt = new Date(t.createdAt).getTime() - 5000; // clock slack
  for (const pid of new Set([t.servicePid, ...pidsOnPort(t.port)])) {
    if (!pid) continue;
    if (pid !== t.servicePid) {
      const started = pidStartedAt(pid);
      if (!started || started.getTime() < createdAt) {
        console.log(`[pi-ui] NOT killing pid ${pid} on port ${t.port} (predates the hublot)`);
        continue;
      }
    }
    if (killPid(pid)) console.log(`[pi-ui] killed hublot service pid ${pid} (port ${t.port})`);
    setTimeout(() => killPid(pid, "SIGKILL"), 3000).unref();
  }

  // 2. the background agent, if it is still working
  if (t.agentProc && t.agentProc.exitCode === null && !t.agentProc.killed) {
    console.log(`[pi-ui] killing hublot agent pid ${t.agentProc.pid} (port ${t.port})`);
    t.agentProc.kill("SIGTERM");
    const ap = t.agentProc;
    setTimeout(() => { if (ap.exitCode === null && !ap.killed) ap.kill("SIGKILL"); }, 3000).unref();
  }

  // 3. the cloudflared tunnel itself
  t.proc.kill("SIGTERM");
  setTimeout(() => {
    if (t.proc.exitCode === null && !t.proc.killed) t.proc.kill("SIGKILL");
  }, 3000).unref();
  return closedInfo; // runtime removal and the final durable transition happen in the exit handler
}

/** Kill every tunnel (server shutdown). */
export function closeAllTunnels(state) {
  for (const row of hublotRepository(state).list()) if (row.status !== "closed") closeTunnel(state, row.id);
}

// ---------------------------------------------------------------- hublot agents

/** Spawn a one-shot background pi agent (`pi -p`) and resolve only after
 *  its local service answers. The caller opens and publishes the tunnel
 *  afterwards, so users never see a hublot that still returns 502. */
export function spawnHublotAgent(state, hublot, brief) {
  return new Promise((resolvePromise, reject) => {
    const prompt =
      `Prepare the following service on local port ${hublot.port}:\n${brief}\n\n` +
      `Do not open a public tunnel. Whatever serves it must keep running after you exit: ` +
      `start it detached in the background (e.g. nohup … & disown) and verify it responds ` +
      `on port ${hublot.port} before finishing.`;
    console.log(`[pi-ui] preparing local service for hublot :${hublot.port}`);
    // --no-session: these one-shot setup runs must not leave session files
    // behind (they would clutter the sessions list)
    const proc = state.piProcesses.ephemeral(["-p", prompt], {
      cwd: state.currentDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
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
      done = true;
      clearInterval(poll);
      if (error) {
        if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
        reject(new Error(error));
        return;
      }
      const servicePid = pidsOnPort(hublot.port)[0] ?? null;
      if (servicePid) console.log(`[pi-ui] hublot :${hublot.port} served by pid ${servicePid}`);
      resolvePromise({ agentProc: proc, servicePid, createdAt });
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

    proc.on("exit", (code) => {
      agentExited = true;
      agentExitAt = Date.now();
      console.log(`[pi-ui] hublot service agent for :${hublot.port} exited (code=${code})`);
    });
    proc.on("error", (error) => finish(`failed to spawn background agent: ${error.message}`));
    proc.unref();
  });
}
