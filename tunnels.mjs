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

export function listTunnels(state) {
  return [...(state.tunnels?.values() ?? [])].map(tunnelInfo);
}

/**
 * Spawn a tunnel for a local port. Resolves with the tunnel entry once the
 * public URL is known; rejects if the process dies or times out first.
 */
export function openTunnel(state, { port, label = null, sessionId = null }) {
  return new Promise((resolvePromise, reject) => {
    port = Number(port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      reject(new Error(`invalid port: ${port}`));
      return;
    }
    if (!state.tunnels) state.tunnels = new Map();
    for (const t of state.tunnels.values()) {
      if (t.port === port) {
        reject(new Error(`port ${port} is already tunneled: ${t.url}`));
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
      id: randomBytes(6).toString("hex"),
      port,
      label,
      sessionId,
      url: null,
      workdir: state.currentDir,
      createdAt: new Date().toISOString(),
      proc,
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
        state.tunnels.set(tunnel.id, tunnel);
        console.log(`[pi-ui] tunnel up: ${tunnel.url} -> localhost:${port}`);
        state.serverEvent({ type: "tunnel_opened", tunnel: tunnelInfo(tunnel) });
        resolvePromise(tunnelInfo(tunnel));
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
        console.log(`[pi-ui] tunnel closed: ${tunnel.url} (code=${code}, signal=${signal})`);
        state.serverEvent({ type: "tunnel_closed", tunnel: tunnelInfo(tunnel) });
      }
    });
  });
}

/** Close one tunnel by id: kills the cloudflared process, the background
 *  agent (if still running), and whatever is serving the port. Returns its
 *  info, or null if unknown. */
export function closeTunnel(state, id) {
  const t = state.tunnels?.get(id);
  if (!t) return null;

  // 1. the service on the port: tracked pid first, plus a live lookup in case
  //    it forked/respawned under a different pid
  const pids = new Set(pidsOnPort(t.port));
  if (t.servicePid) pids.add(t.servicePid);
  for (const pid of pids) {
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
  return tunnelInfo(t); // removal from the map happens in the exit handler
}

/** Kill every tunnel (server shutdown). */
export function closeAllTunnels(state) {
  for (const id of [...(state.tunnels?.keys() ?? [])]) closeTunnel(state, id);
}
