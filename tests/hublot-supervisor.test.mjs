import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { createHublotSupervisor, scheduleHublotStartupReconciliation } from "../server/persistence/hublotSupervisor.mjs";
import { processIdentityMatches } from "../server/persistence/processIdentity.mjs";
import { recordHublotTransition, reserveHublot } from "../server/tunnels.mjs";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-hublot-supervisor-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root };
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, state };
}

async function processRow(store, hublotId, id, role) {
  return await store.repositories.hublots.upsertProcess({
    id, hublotId, role, pid: role === "tunnel" ? 4101 : 4102,
    processGroupId: 4100, bootId: "boot", procStartTicks: role === "tunnel" ? "101" : "102",
    executable: role === "tunnel" ? "/usr/bin/cloudflared" : "/usr/bin/node",
    commandSha256: `command-${role}`, status: "running", startedAt: "started",
  });
}

test("supervisor closes every desired-open hublot whose process identity is not live", async (t) => {
  const { store, state } = await fixture(t);
  const healthy = await reserveHublot(state, { port: 4200 });
  await recordHublotTransition(state, healthy.id, "open", { publicUrl: "https://healthy.test" });
  await processRow(store, healthy.id, "healthy-tunnel", "tunnel");
  await store.repositories.hublots.update(healthy.id, { service_kind: "agent_managed" });
  await processRow(store, healthy.id, "lost-legacy-service", "service");

  const stale = await reserveHublot(state, { port: 4201 });
  await recordHublotTransition(state, stale.id, "open", { publicUrl: "https://stale.test" });
  await processRow(store, stale.id, "stale-tunnel", "tunnel");
  await processRow(store, stale.id, "healthy-stale-service", "service");

  const closed = await reserveHublot(state, { port: 4202 });
  await recordHublotTransition(state, closed.id, "closed", { desiredState: "closed", closedAt: "closed" });
  await processRow(store, closed.id, "closed-tunnel", "tunnel");

  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition: async (id, status, options) => await recordHublotTransition(state, id, status, options),
    verifyIdentity: (process) => process.id.startsWith("healthy"),
    now: () => "observed",
  });
  const result = await supervisor.reconcile();

  assert.deepEqual(result, { skipped: false, checked: 2, interrupted: 1 });
  assert.equal((await store.repositories.hublots.find(healthy.id)).status, "open", "a missing legacy service must not close a healthy tunnel");
  assert.equal((await store.repositories.hublots.findProcess("lost-legacy-service")).status, "running", "legacy service records are no longer monitored");
  assert.equal((await store.repositories.hublots.find(healthy.id)).public_url, "https://healthy.test");
  assert.equal((await store.repositories.hublots.findProcess("healthy-tunnel")).observed_at, "observed");
  assert.equal((await store.repositories.hublots.find(stale.id)).status, "closed");
  assert.equal((await store.repositories.hublots.find(stale.id)).desired_state, "closed");
  assert.equal((await store.repositories.hublots.find(stale.id)).public_url, null);
  assert.match((await store.repositories.hublots.find(stale.id)).last_error, /process identity was lost/);
  assert.equal((await store.repositories.hublots.findProcess("stale-tunnel")).status, "lost");
  assert.equal((await store.repositories.hublots.findProcess("stale-tunnel")).ended_at, "observed");
  assert.equal((await store.repositories.hublots.find(closed.id)).status, "closed");
});

test("startup reconciliation retires stale quick tunnels instead of recreating their URLs", async (t) => {
  const { store, state } = await fixture(t);
  const statuses = ["opening", "open", "recovering", "failed", "interrupted"];
  const rows = [];
  for (const [index, status] of statuses.entries()) {
    const row = await reserveHublot(state, { port: 4210 + index });
    if (status !== "opening") await recordHublotTransition(state, row.id, status, { publicUrl: `https://${status}.test` });
    rows.push(row);
  }
  const closed = await reserveHublot(state, { port: 4220 });
  await recordHublotTransition(state, closed.id, "closed", { desiredState: "closed", closedAt: "closed" });
  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition: async (id, status, options) => await recordHublotTransition(state, id, status, options),
    verifyIdentity: () => false,
    now: () => "startup",
  });

  const result = await supervisor.reconcile({ includeOpening: true });

  assert.equal(result.checked, statuses.length);
  assert.equal(result.interrupted, statuses.length);
  for (const row of rows) {
    const retired = await store.repositories.hublots.find(row.id);
    assert.equal(retired.status, "closed");
    assert.equal(retired.desired_state, "closed");
    assert.equal(retired.public_url, null);
    assert.match(retired.last_error, /process identity was lost/);
  }
  assert.equal((await store.repositories.hublots.find(closed.id)).status, "closed");
});

test("supervisor re-checks a hublot before closing it, so a concurrent manual close is not overwritten", async (t) => {
  const { store, state } = await fixture(t);
  const hublot = await reserveHublot(state, { port: 4203 });
  await recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://race.test" });
  await processRow(store, hublot.id, "race-tunnel", "tunnel");
  const hublots = store.repositories.hublots;
  const transitions = [];
  // Land a manual close after reconcile has already selected this hublot as
  // desired-open but before it decides whether to close it.
  const racing = {
    transaction: (work) => store.transaction(work),
    repositories: {
      hublots: {
        list: (...args) => hublots.list(...args),
        find: (...args) => hublots.find(...args),
        update: (...args) => hublots.update(...args),
        updateProcess: (...args) => hublots.updateProcess(...args),
        async listProcesses(id) {
          await recordHublotTransition(state, id, "closed", { desiredState: "closed", publicUrl: null, closedAt: "manual" });
          return await hublots.listProcesses(id);
        },
      },
    },
  };
  const supervisor = createHublotSupervisor({
    appStore: racing,
    recordTransition: async (id, status, options) => { transitions.push(status); return await recordHublotTransition(state, id, status, options); },
    verifyIdentity: () => false,
    now: () => "observed",
  });

  const result = await supervisor.reconcile();

  assert.deepEqual(result, { skipped: false, checked: 1, interrupted: 0 });
  assert.deepEqual(transitions, [], "reconcile must not record a transition over the manual close");
  const closed = await hublots.find(hublot.id);
  assert.equal(closed.status, "closed");
  assert.equal(closed.desired_state, "closed");
  assert.equal(closed.closed_at, "manual");
});

test("supervisor validates callbacks and timing configuration", async (t) => {
  const { store } = await fixture(t);
  const base = { appStore: store, recordTransition() {} };

  assert.throws(() => createHublotSupervisor({ ...base, verifyIdentity: true }), /process identity verifier/);
  assert.throws(() => createHublotSupervisor({ ...base, intervalMs: 0 }), /supervisor interval/);
});

test("periodic supervisor starts and stops one unrefed timer", async (t) => {
  const { store, state } = await fixture(t);
  const hublot = await reserveHublot(state, { port: 4203 });
  await recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://periodic.test" });
  await processRow(store, hublot.id, "periodic-tunnel", "tunnel");
  let callback = null;
  let cleared = null;
  let unrefed = false;
  const timer = { unref() { unrefed = true; } };
  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition: async (id, status, options) => await recordHublotTransition(state, id, status, options),
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

test("periodic supervisor supports a numeric zero timer handle", async (t) => {
  const { store } = await fixture(t);
  let cleared = null;
  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition() {},
    setIntervalFn: () => 0,
    clearIntervalFn: (handle) => { cleared = handle; },
  });

  assert.equal(supervisor.start(), 0);
  assert.equal(supervisor.start(), 0);
  assert.equal(supervisor.running, true);
  supervisor.stop();
  assert.equal(cleared, 0);
  assert.equal(supervisor.running, false);
});

test("application startup supervises immediately while full hublot reconciliation runs asynchronously", async () => {
  const calls = [];
  let finishReconciliation;
  const report = { checked: 2, interrupted: 0 };
  const reconciliation = new Promise((resolve) => { finishReconciliation = resolve; });
  const state = {
    hublotStartupReconciled: false,
    hublotStartupReconciliationTask: null,
  };
  const supervisor = {
    reconcile(options) { calls.push(`reconcile:${options.includeOpening}`); return reconciliation; },
    start() { calls.push("start"); },
  };

  const task = scheduleHublotStartupReconciliation({ state, supervisor });

  assert.deepEqual(calls, ["start"], "scheduling must return before reconciliation starts");
  assert.equal(state.hublotStartupReconciled, false);
  await Promise.resolve();
  assert.deepEqual(calls, ["start", "reconcile:true"]);

  finishReconciliation(report);
  assert.equal(await task, report);
  assert.equal(state.hublotStartupReconciled, true);
  assert.equal(state.hublotStartupReconciliation, report);
  assert.equal(state.hublotStartupReconciliationTask, null);

  const app = readFileSync(new URL("../server/app.mjs", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server/server.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(app, /await scheduleHublotStartupReconciliation/);
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
