import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import {
  persistHublotProcessIdentity, recordHublotTransition, reserveHublot, shutdownHublots,
} from "../server/tunnels.mjs";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-hublot-shutdown-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = {
    appStore: store,
    config: { PI_AGENT_DIR: join(root, "agent") },
    currentDir: root,
    hublotProcessHandles: new Map(),
  };
  const children = [];
  const child = () => {
    const proc = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
    children.push(proc);
    return proc;
  };
  t.after(async () => {
    for (const proc of children) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
    await store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { store, state, child };
}

test("graceful hublot shutdown awaits bounded escalation and retires ephemeral quick tunnels", async (t) => {
  const { store, state, child } = await fixture(t);
  const managed = await reserveHublot(state, { port: 4240, brief: "managed preview" });
  const selfServed = await reserveHublot(state, { port: 4241, serviceKind: "self_served" });
  await recordHublotTransition(state, managed.id, "open", { publicUrl: "https://managed.trycloudflare.com" });
  await recordHublotTransition(state, selfServed.id, "open", { publicUrl: "https://self.trycloudflare.com" });

  const managedTunnel = await persistHublotProcessIdentity(state, { hublotId: managed.id, role: "tunnel", pid: child().pid });
  const managedService = await persistHublotProcessIdentity(state, { hublotId: managed.id, role: "service", pid: child().pid });
  const selfTunnel = await persistHublotProcessIdentity(state, { hublotId: selfServed.id, role: "tunnel", pid: child().pid });
  const selfService = await persistHublotProcessIdentity(state, { hublotId: selfServed.id, role: "service", pid: child().pid });
  const alive = new Set([managedTunnel.id, managedService.id, selfTunnel.id, selfService.id]);
  const processByPid = new Map((await store.repositories.hublots.listProcesses(managed.id))
    .concat(await store.repositories.hublots.listProcesses(selfServed.id)).map((row) => [row.pid, row]));
  const signals = [];
  let time = 0;

  const result = await shutdownHublots(state, {
    termTimeoutMs: 100,
    killTimeoutMs: 50,
    pollIntervalMs: 25,
    clock: () => time,
    sleep: async (ms) => { time += ms; },
    verifyIdentity: (row) => alive.has(row.id),
    signalProcess(pid, signal) {
      const row = processByPid.get(pid);
      signals.push(`${row.id}:${signal}`);
      if (signal === "SIGKILL" || row.role === "tunnel") alive.delete(row.id);
    },
  });

  assert.deepEqual(result, { targeted: 3, escalated: 1, remaining: 0 });
  assert.equal(signals.filter((value) => value.endsWith(":SIGTERM")).length, 3);
  assert.deepEqual(signals.filter((value) => value.endsWith(":SIGKILL")), [`${managedService.id}:SIGKILL`]);
  for (const id of [managed.id, selfServed.id]) {
    const row = await store.repositories.hublots.find(id);
    assert.equal(row.status, "closed");
    assert.equal(row.desired_state, "closed");
    assert.equal(row.public_url, null);
    assert.match(row.last_error, /ephemeral cloudflared tunnels are not recreated/);
  }
  assert.equal((await store.repositories.hublots.findProcess(managedTunnel.id)).status, "ended");
  assert.equal((await store.repositories.hublots.findProcess(managedService.id)).status, "ended");
  assert.equal((await store.repositories.hublots.findProcess(selfTunnel.id)).status, "ended");
  assert.equal((await store.repositories.hublots.findProcess(selfService.id)).status, "running", "self-served services are not app-managed");

  const historyCounts = await Promise.all([managed.id, selfServed.id].map(async (id) => (await store.repositories.hublots.listLifecycleEvents(id)).length));
  assert.deepEqual(await shutdownHublots(state, { verifyIdentity: () => false }), { targeted: 0, escalated: 0, remaining: 0 });
  assert.deepEqual(await Promise.all([managed.id, selfServed.id].map(async (id) => (await store.repositories.hublots.listLifecycleEvents(id)).length)), historyCounts);
});
