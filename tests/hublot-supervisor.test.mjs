import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { createHublotSupervisor } from "../persistence/hublotSupervisor.mjs";
import { processIdentityMatches } from "../persistence/processIdentity.mjs";
import { recordHublotTransition, reserveHublot } from "../tunnels.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-supervisor-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root };
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, state };
}

function processRow(store, hublotId, id, role) {
  return store.repositories.hublots.upsertProcess({
    id, hublotId, role, pid: role === "tunnel" ? 4101 : 4102,
    processGroupId: 4100, bootId: "boot", procStartTicks: role === "tunnel" ? "101" : "102",
    executable: role === "tunnel" ? "/usr/bin/cloudflared" : "/usr/bin/node",
    commandSha256: `command-${role}`, status: "running", startedAt: "started",
  });
}

test("supervisor reconciles every desired-open hublot against persisted identities", async (t) => {
  const { store, state } = fixture(t);
  const healthy = reserveHublot(state, { port: 4200 });
  recordHublotTransition(state, healthy.id, "open", { publicUrl: "https://healthy.test" });
  processRow(store, healthy.id, "healthy-tunnel", "tunnel");
  processRow(store, healthy.id, "healthy-service", "service");

  const stale = reserveHublot(state, { port: 4201 });
  recordHublotTransition(state, stale.id, "open", { publicUrl: "https://stale.test" });
  processRow(store, stale.id, "stale-tunnel", "tunnel");

  const closed = reserveHublot(state, { port: 4202 });
  recordHublotTransition(state, closed.id, "closed", { desiredState: "closed", closedAt: "closed" });
  processRow(store, closed.id, "closed-tunnel", "tunnel");

  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition: (id, status, options) => recordHublotTransition(state, id, status, options),
    verifyIdentity: (process) => process.id.startsWith("healthy"),
    now: () => "observed",
  });
  const result = await supervisor.reconcile();

  assert.deepEqual(result, { skipped: false, checked: 2, recovering: 1, restarted: 0, recoveredTunnels: 0 });
  assert.equal(store.repositories.hublots.find(healthy.id).status, "open");
  assert.equal(store.repositories.hublots.find(healthy.id).public_url, "https://healthy.test");
  assert.equal(store.repositories.hublots.findProcess("healthy-tunnel").observed_at, "observed");
  assert.equal(store.repositories.hublots.find(stale.id).status, "recovering");
  assert.equal(store.repositories.hublots.find(stale.id).public_url, null);
  assert.match(store.repositories.hublots.find(stale.id).last_error, /tunnel process identity is not live/);
  assert.equal(store.repositories.hublots.findProcess("stale-tunnel").status, "lost");
  assert.equal(store.repositories.hublots.findProcess("stale-tunnel").ended_at, "observed");
  assert.equal(store.repositories.hublots.find(closed.id).status, "closed");
});

test("startup reconciliation includes every persisted desired-open state", async (t) => {
  const { store, state } = fixture(t);
  const statuses = ["opening", "open", "recovering", "failed", "interrupted"];
  const rows = [];
  for (const [index, status] of statuses.entries()) {
    const row = reserveHublot(state, { port: 4210 + index });
    if (status !== "opening") recordHublotTransition(state, row.id, status, { publicUrl: `https://${status}.test` });
    rows.push(row);
  }
  const closed = reserveHublot(state, { port: 4220 });
  recordHublotTransition(state, closed.id, "closed", { desiredState: "closed", closedAt: "closed" });
  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition: (id, status, options) => recordHublotTransition(state, id, status, options),
    verifyIdentity: () => false,
    now: () => "startup",
  });

  const result = await supervisor.reconcile({ includeOpening: true });

  assert.equal(result.checked, statuses.length);
  assert.equal(result.recovering, statuses.length);
  for (const row of rows) {
    assert.equal(store.repositories.hublots.find(row.id).status, "recovering");
    assert.equal(store.repositories.hublots.find(row.id).public_url, null);
  }
  assert.equal(store.repositories.hublots.find(closed.id).status, "closed");
});

test("periodic supervisor starts and stops one unrefed timer", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4203 });
  recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://periodic.test" });
  processRow(store, hublot.id, "periodic-tunnel", "tunnel");
  let callback = null;
  let cleared = null;
  let unrefed = false;
  const timer = { unref() { unrefed = true; } };
  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition: (id, status, options) => recordHublotTransition(state, id, status, options),
    verifyIdentity: () => true,
    setIntervalFn(fn, interval) { callback = fn; assert.equal(interval, 1234); return timer; },
    clearIntervalFn(value) { cleared = value; },
    intervalMs: 1234,
  });
  assert.equal(supervisor.start(), timer);
  assert.equal(supervisor.start(), timer);
  assert.equal(unrefed, true);
  callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supervisor.running, true);
  supervisor.stop();
  assert.equal(cleared, timer);
  assert.equal(supervisor.running, false);
});

test("application startup awaits one full reconciliation before periodic supervision", () => {
  const app = readFileSync(new URL("../app.mjs", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.ok(app.indexOf("await state.hublotSupervisor.reconcile({ includeOpening: true })") < app.indexOf("state.hublotSupervisor.start()"));
  assert.match(app, /if \(!state\.hublotStartupReconciled\)/);
  assert.ok(server.indexOf("await loadApp()") < server.indexOf("server.listen("));
});

test("identity verification rejects PID-only, restarted, and fingerprint-mismatched processes", () => {
  const record = {
    pid: 99, process_group_id: 90, boot_id: "boot", proc_start_ticks: "123",
    executable: "/usr/bin/node", command_sha256: "command",
  };
  const observed = {
    pid: 99, processGroupId: 90, bootId: "boot", procStartTicks: "123",
    executable: "/usr/bin/node", commandSha256: "command",
  };
  assert.equal(processIdentityMatches(record, observed), true);
  assert.equal(processIdentityMatches({ pid: 99 }, observed), false);
  assert.equal(processIdentityMatches(record, { ...observed, procStartTicks: "124" }), false);
  assert.equal(processIdentityMatches(record, { ...observed, commandSha256: "other" }), false);
});
