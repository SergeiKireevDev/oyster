import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { createHublotSupervisor } from "../persistence/hublotSupervisor.mjs";
import {
  persistHublotProcessIdentity, recordHublotTransition, recoverAnsweringHublotService,
  reserveHublot, restartHublotService,
} from "../tunnels.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-restart-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root, serverEvent() {} };
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, state };
}

test("dead services restart, pass a live port check, persist replacement PID, then reopen", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4230, brief: "serve preview" });
  recordHublotTransition(state, hublot.id, "recovering", { publicUrl: null });
  const order = [];

  const result = await restartHublotService(state, hublot, {
    invoke(_state, id) { order.push(`invoke:${id}`); },
    async waitForPort(port) { order.push(`verify:${port}`); },
    discoverPids(port) { order.push(`discover:${port}`); return [process.pid]; },
    persistProcess(targetState, details) {
      order.push(`persist:${details.pid}`);
      return persistHublotProcessIdentity(targetState, details);
    },
    async reopenTunnel(_state, options) {
      order.push(`reopen:${options.id}`);
      const replacement = store.repositories.hublots.listProcesses(options.id)
        .find((row) => row.role === "service" && row.pid === process.pid && row.status === "running");
      assert.ok(replacement, "replacement service identity must commit before tunnel reopening");
      return { id: options.id, url: "https://replacement.test" };
    },
  });

  assert.deepEqual(order, [
    `invoke:${hublot.id}`, "verify:4230", "discover:4230", `persist:${process.pid}`, `reopen:${hublot.id}`,
  ]);
  assert.equal(result.hublotId, hublot.id);
  assert.equal(result.servicePid, process.pid);
  assert.equal(result.serviceProcess.pid, process.pid);
  assert.equal(result.tunnel.id, hublot.id, "recovery must retain stable hublot identity");
});

test("an answering service receives a replacement tunnel identity and durable URL", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4233 });
  recordHublotTransition(state, hublot.id, "recovering", { publicUrl: null });
  const order = [];
  const recovered = await recoverAnsweringHublotService(state, hublot, {
    checkPort: async (port) => { order.push(`answer:${port}`); return true; },
    discoverPids: () => [process.pid],
    persistProcess(targetState, details) {
      order.push(`service:${details.pid}`);
      return persistHublotProcessIdentity(targetState, details);
    },
    async reopenTunnel(targetState, options) {
      const service = store.repositories.hublots.listProcesses(options.id).find((row) => row.role === "service" && row.status === "running");
      assert.ok(service, "answering service identity must persist before replacement tunnel spawn");
      order.push("tunnel");
      const tunnelProcess = persistHublotProcessIdentity(targetState, { hublotId: options.id, role: "tunnel", pid: process.pid });
      recordHublotTransition(targetState, options.id, "open", { publicUrl: "https://new-url.test", openedAt: "reopened" });
      return { id: options.id, url: "https://new-url.test", process: tunnelProcess };
    },
  });
  assert.deepEqual(order, [`answer:${hublot.port}`, `service:${process.pid}`, "tunnel"]);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.hublotId, hublot.id);
  assert.equal(recovered.tunnel.id, hublot.id);
  const persisted = store.repositories.hublots.find(hublot.id);
  assert.equal(persisted.status, "open");
  assert.equal(persisted.public_url, "https://new-url.test");
  assert.ok(store.repositories.hublots.listProcesses(hublot.id).some((row) => row.role === "tunnel"));
});

test("a silent local port is not tunneled or assigned a URL", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4234 });
  let reopened = false;
  const result = await recoverAnsweringHublotService(state, hublot, {
    checkPort: async () => false,
    reopenTunnel: async () => { reopened = true; },
  });
  assert.deepEqual(result, { recovered: false, answering: false, hublotId: hublot.id });
  assert.equal(reopened, false);
  assert.equal(store.repositories.hublots.find(hublot.id).public_url, null);
});

test("failed port verification records failure and never reopens a tunnel", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4231, brief: "serve preview" });
  let reopened = false;
  await assert.rejects(() => restartHublotService(state, hublot, {
    invoke() {},
    waitForPort: async () => { throw new Error("port remained down"); },
    reopenTunnel: async () => { reopened = true; },
  }), /port remained down/);
  assert.equal(reopened, false);
  assert.equal(store.repositories.hublots.find(hublot.id).status, "failed");
  assert.equal(store.repositories.hublots.find(hublot.id).public_url, null);
  assert.equal(store.repositories.hublots.find(hublot.id).last_error, "port remained down");
});

test("supervisor recovers an answering service before considering service restart", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4235, brief: "serve preview" });
  recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://old-url.test" });
  const calls = [];
  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition: (id, status, options) => recordHublotTransition(state, id, status, options),
    verifyIdentity: () => false,
    recoverTunnel: async (row) => { calls.push(`recover:${row.id}`); return { recovered: true }; },
    restartService: async (row) => calls.push(`restart:${row.id}`),
  });
  const result = await supervisor.reconcile();
  assert.deepEqual(calls, [`recover:${hublot.id}`]);
  assert.equal(result.recoveredTunnels, 1);
  assert.equal(result.restarted, 0);
});

test("supervisor delegates dead agent-managed services to restart recovery", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4232, brief: "serve preview" });
  recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://stale.test" });
  const restarted = [];
  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition: (id, status, options) => recordHublotTransition(state, id, status, options),
    verifyIdentity: () => false,
    restartService: async (row) => restarted.push(row.id),
    now: () => "observed",
  });
  const result = await supervisor.reconcile();
  assert.deepEqual(restarted, [hublot.id]);
  assert.equal(result.restarted, 1);
  assert.equal(store.repositories.hublots.find(hublot.id).status, "recovering");
  assert.equal(store.repositories.hublots.find(hublot.id).public_url, null);
});
