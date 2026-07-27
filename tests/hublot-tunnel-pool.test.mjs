import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import {
  HUBLOT_TUNNEL_POOL_LABEL,
  acquireHublotTunnelPoolEntry,
  listTunnels,
  persistHublotProcessIdentity,
  recordHublotTransition,
  reserveHublot,
  shutdownHublots,
  spawnHublotTunnelPoolDummy,
} from "../server/tunnels.mjs";

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

test("reserved warm tunnels serve the waiting page and stay out of public hublot listings", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-pool-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = {
    appStore: store,
    config: { PI_AGENT_DIR: join(root, "agent"), HUBLOT_TUNNEL_POOL_SIZE: 2 },
    currentDir: root,
    hublotProcessHandles: new Map(),
  };
  t.after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  const reserved = reserveHublot(state, {
    port: await unusedPort(),
    label: HUBLOT_TUNNEL_POOL_LABEL,
    brief: "__oyster_reserved_tunnel_waiting_for_hublot__",
    serviceKind: "self_served",
  });
  const dummy = await spawnHublotTunnelPoolDummy(state, reserved);
  const response = await fetch(`http://127.0.0.1:${reserved.port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /tunnel to be created here/);
  assert.deepEqual(listTunnels(state), []);

  dummy.serviceProc.ref();
  const exited = once(dummy.serviceProc, "exit");
  const shutdown = await shutdownHublots(state);
  await exited;
  assert.deepEqual(shutdown, { targeted: 1, escalated: 0, remaining: 0 });
  assert.equal(store.repositories.hublots.findProcess(dummy.serviceProcess.id).status, "ended");
  assert.equal(store.repositories.hublots.find(reserved.id).status, "closed");
});

test("claiming a warm tunnel kills only the dummy and preserves its cloudflared URL", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-pool-claim-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  let sizeReads = 0;
  const config = { PI_AGENT_DIR: join(root, "agent") };
  Object.defineProperty(config, "HUBLOT_TUNNEL_POOL_SIZE", {
    get() { return sizeReads++ === 0 ? 1 : 0; },
  });
  const state = {
    appStore: store,
    config,
    currentDir: root,
    hublotProcessHandles: new Map(),
    hublotTunnelPoolQueue: Promise.resolve(),
    hublotTunnelPoolRefillTask: null,
    hublotTunnelPoolRefillRequested: false,
    hublotTunnelPoolStopping: false,
  };
  const tunnelProc = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  t.after(async () => {
    if (tunnelProc.exitCode === null) {
      const exited = once(tunnelProc, "exit");
      tunnelProc.kill("SIGKILL");
      await exited;
    }
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  const reserved = reserveHublot(state, {
    port: await unusedPort(),
    label: HUBLOT_TUNNEL_POOL_LABEL,
    brief: "__oyster_reserved_tunnel_waiting_for_hublot__",
    serviceKind: "self_served",
  });
  const dummy = await spawnHublotTunnelPoolDummy(state, reserved);
  persistHublotProcessIdentity(state, { hublotId: reserved.id, role: "tunnel", pid: tunnelProc.pid });
  recordHublotTransition(state, reserved.id, "open", { publicUrl: "https://warm.trycloudflare.com" });
  dummy.serviceProc.ref();
  const dummyExited = once(dummy.serviceProc, "exit");

  const claimed = await acquireHublotTunnelPoolEntry(state, {
    label: "real app", brief: "serve the real app", ownerId: null,
  });
  await dummyExited;

  assert.equal(claimed.id, reserved.id);
  assert.equal(claimed.port, reserved.port);
  assert.equal(claimed.public_url, "https://warm.trycloudflare.com");
  assert.equal(claimed.label, "real app");
  assert.equal(claimed.brief, "serve the real app");
  assert.equal(claimed.service_kind, "agent_managed");
  assert.equal(claimed.status, "opening");
  assert.equal(tunnelProc.exitCode, null, "claiming must preserve the warm cloudflared process");
  assert.equal(store.repositories.hublots.findProcess(dummy.serviceProcess.id).status, "ended");
  assert.deepEqual(listTunnels(state), [{
    id: reserved.id,
    port: reserved.port,
    label: "real app",
    sessionId: null,
    status: "opening",
    url: null,
    workdir: root,
    createdAt: claimed.created_at,
  }]);
});
