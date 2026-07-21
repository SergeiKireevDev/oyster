import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { createHublotSupervisor } from "../persistence/hublotSupervisor.mjs";
import {
  persistHublotProcessIdentity, recordHublotTransition, reserveHublot, restartHublotService,
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
