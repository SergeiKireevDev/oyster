import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { createTunnelRoutes } from "../http/routes/tunnelRoutes.mjs";
import {
  listTunnels, persistHublotProcessIdentity, rebindHublot,
  recordHublotTransition, reserveHublot,
} from "../tunnels.mjs";

function response() {
  return { status: null, body: null };
}

test("route payloads, SSE events, tool endpoints, and hublot IDs remain stable across restart", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-compat-"));
  const databasePath = join(root, "app.sqlite");
  let store = openAppStore({ databasePath });
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  t.after(() => {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    try { store.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  });

  const owner = store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "session-1", storagePath: "/agent.sqlite", createdAt: "created" });
  let state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root, serverEvent() {} };
  const reserved = reserveHublot(state, { port: 4242, label: "preview", sessionId: "session-1", ownerId: owner.id });
  persistHublotProcessIdentity(state, { hublotId: reserved.id, role: "tunnel", pid: child.pid });
  recordHublotTransition(state, reserved.id, "open", { publicUrl: "https://stable.trycloudflare.com" });
  const beforeRestart = listTunnels(state)[0];
  assert.equal(beforeRestart.id, reserved.id);

  store.close();
  store = openAppStore({ databasePath });
  const events = [];
  state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root, serverEvent: (event) => events.push(event) };
  const restored = listTunnels(state)[0];
  assert.deepEqual(restored, beforeRestart);
  assert.equal(restored.id, reserved.id, "durable identity must not be regenerated on restart");

  const routes = createTunnelRoutes({
    state,
    config: { TUNNEL_BIN: "cloudflared" },
    requestContext: {
      json(res, status, body) { res.status = status; res.body = body; },
      async readJsonBody(req) { return req.body; },
    },
    listTunnels,
    allocateHublot: () => { throw new Error("unused"); },
    reserveHublot: () => { throw new Error("unused"); },
    recordHublotTransition,
    rebindHublot,
    openTunnel: () => { throw new Error("unused"); },
    closeTunnel: () => { throw new Error("unused"); },
    spawnHublotAgent: () => { throw new Error("unused"); },
    ensureSessionOwner: () => owner,
  });
  const listed = response();
  routes["GET /tunnels"]({}, listed);
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body, { tunnels: [restored], bin: "cloudflared" });

  const patched = response();
  await routes["PATCH /tunnels"]({ body: { id: reserved.id, sessionId: "session-1" } }, patched);
  assert.equal(patched.status, 200);
  assert.equal(patched.body.tunnel.id, reserved.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "tunnel_opened");
  assert.equal(events[0].tunnel.id, reserved.id);

  const toolSource = readFileSync(new URL("../extensions/hublot.ts", import.meta.url), "utf8");
  assert.match(toolSource, /api\("POST", "\/tunnels"/);
  assert.match(toolSource, /api\("GET", "\/tunnels"/);
  assert.match(toolSource, /api\("DELETE", `\/tunnels\?id=/);
});
