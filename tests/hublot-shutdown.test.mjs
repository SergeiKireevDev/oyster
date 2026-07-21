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

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-shutdown-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
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
  t.after(() => {
    for (const proc of children) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { store, state, child };
}

test("graceful hublot shutdown awaits bounded escalation and retains desired-open recovery state", async (t) => {
  const { store, state, child } = fixture(t);
  const managed = reserveHublot(state, { port: 4240, brief: "managed preview" });
  const selfServed = reserveHublot(state, { port: 4241, serviceKind: "self_served" });
  recordHublotTransition(state, managed.id, "open", { publicUrl: "https://managed.trycloudflare.com" });
  recordHublotTransition(state, selfServed.id, "open", { publicUrl: "https://self.trycloudflare.com" });

  const managedTunnel = persistHublotProcessIdentity(state, { hublotId: managed.id, role: "tunnel", pid: child().pid });
  const managedService = persistHublotProcessIdentity(state, { hublotId: managed.id, role: "service", pid: child().pid });
  const selfTunnel = persistHublotProcessIdentity(state, { hublotId: selfServed.id, role: "tunnel", pid: child().pid });
  const selfService = persistHublotProcessIdentity(state, { hublotId: selfServed.id, role: "service", pid: child().pid });
  const alive = new Set([managedTunnel.id, managedService.id, selfTunnel.id, selfService.id]);
  const processByPid = new Map(store.repositories.hublots.listProcesses(managed.id)
    .concat(store.repositories.hublots.listProcesses(selfServed.id)).map((row) => [row.pid, row]));
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
    const row = store.repositories.hublots.find(id);
    assert.equal(row.status, "interrupted");
    assert.equal(row.desired_state, "open");
    assert.equal(row.public_url, null);
    assert.match(row.last_error, /recovery will resume/);
  }
  assert.equal(store.repositories.hublots.findProcess(managedTunnel.id).status, "ended");
  assert.equal(store.repositories.hublots.findProcess(managedService.id).status, "ended");
  assert.equal(store.repositories.hublots.findProcess(selfTunnel.id).status, "ended");
  assert.equal(store.repositories.hublots.findProcess(selfService.id).status, "running", "self-served services are not app-managed");

  const historyCounts = [managed.id, selfServed.id].map((id) => store.repositories.hublots.listLifecycleEvents(id).length);
  assert.deepEqual(await shutdownHublots(state, { verifyIdentity: () => false }), { targeted: 0, escalated: 0, remaining: 0 });
  assert.deepEqual([managed.id, selfServed.id].map((id) => store.repositories.hublots.listLifecycleEvents(id).length), historyCounts);
});
