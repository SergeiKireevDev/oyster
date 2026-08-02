import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { createHublotSupervisor, scheduleHublotStartupReconciliation } from "../server/persistence/hublotSupervisor.mjs";
import { processIdentityMatches } from "../server/persistence/processIdentity.mjs";
import { recordHublotTransition, reserveHublot } from "../server/tunnels.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-hublot-supervisor-"));
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
  processRow(store, stale.id, "healthy-stale-service", "service");

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

  assert.deepEqual(result, { skipped: false, checked: 2, recovering: 1, restarted: 0, recoveredTunnels: 0, deferred: 0, crashLooped: 0, interrupted: 0 });
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

test("startup reconciliation retires stale quick tunnels instead of recreating their URLs", async (t) => {
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
  let recoveryAttempts = 0;
  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition: (id, status, options) => recordHublotTransition(state, id, status, options),
    recoverTunnel: async () => { recoveryAttempts++; throw new Error("must not recreate cloudflared at startup"); },
    restartService: async () => { recoveryAttempts++; throw new Error("must not restart a retired hublot"); },
    verifyIdentity: () => false,
    now: () => "startup",
  });

  const result = await supervisor.reconcile({ includeOpening: true, recoverMissing: false });
  assert.equal(recoveryAttempts, 0);

  assert.equal(result.checked, statuses.length);
  assert.equal(result.recovering, 0);
  assert.equal(result.interrupted, statuses.length);
  for (const row of rows) {
    const retired = store.repositories.hublots.find(row.id);
    assert.equal(retired.status, "closed");
    assert.equal(retired.desired_state, "closed");
    assert.equal(retired.public_url, null);
    assert.match(retired.last_error, /ephemeral cloudflared tunnels are not recreated/);
  }
  assert.equal(store.repositories.hublots.find(closed.id).status, "closed");
});

test("repeated service failure uses bounded backoff and crash-loop protection instead of unbounded spawning", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4221, brief: "managed service" });
  recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://crashing.test" });
  let time = Date.parse("2026-01-01T00:00:00.000Z");
  let restartAttempts = 0;
  const options = {
    appStore: store,
    recordTransition: (id, status, details) => recordHublotTransition(state, id, status, details),
    recoverTunnel: async () => ({ recovered: false, answering: false }),
    restartService: async () => { restartAttempts++; throw new Error(`crash-${restartAttempts}`); },
    verifyIdentity: () => false,
    clock: () => time,
    now: () => new Date(time).toISOString(),
    restartBaseDelayMs: 100,
    restartMaxDelayMs: 150,
    restartLimit: 3,
    logger: { error() {} },
  };
  let supervisor = createHublotSupervisor(options);

  await supervisor.reconcile();
  assert.equal(restartAttempts, 1);
  assert.equal(store.repositories.hublots.find(hublot.id).restart_count, 1);
  assert.equal(store.repositories.hublots.find(hublot.id).next_restart_at, "2026-01-01T00:00:00.100Z");

  supervisor = createHublotSupervisor(options); // restart state must survive supervisor replacement
  const deferred = await supervisor.reconcile();
  assert.equal(deferred.deferred, 1);
  assert.equal(restartAttempts, 1);

  time += 100;
  await supervisor.reconcile();
  assert.equal(restartAttempts, 2);
  assert.equal(store.repositories.hublots.find(hublot.id).restart_count, 2);
  assert.equal(store.repositories.hublots.find(hublot.id).next_restart_at, "2026-01-01T00:00:00.250Z");

  time += 150;
  const limited = await supervisor.reconcile();
  assert.equal(restartAttempts, 3);
  assert.equal(limited.crashLooped, 1);
  assert.equal(store.repositories.hublots.find(hublot.id).status, "interrupted");
  assert.equal(store.repositories.hublots.find(hublot.id).restart_count, 3);
  assert.equal(store.repositories.hublots.find(hublot.id).next_restart_at, null);
  assert.match(store.repositories.hublots.find(hublot.id).last_error, /automatic restart disabled after 3 consecutive failures/);

  const historyAtCutoff = store.repositories.hublots.listLifecycleEvents(hublot.id).length;
  for (let pass = 0; pass < 100; pass++) {
    time += 60_000;
    await supervisor.reconcile();
  }
  assert.equal(store.repositories.hublots.listLifecycleEvents(hublot.id).length, historyAtCutoff, "cutoff does not append unbounded transition history");
  assert.equal(restartAttempts, 3, "crash-looped hublots must not spawn again even after backoff deadlines pass");
  assert.equal(store.repositories.hublots.find(hublot.id).desired_state, "open", "cutoff remains durable until an operator intervenes");
});

test("supervisor does not overwrite a manual close during an asynchronous health check", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4203, serviceKind: "self_served" });
  recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://race.test" });
  let finishCheck;
  const checkStarted = new Promise((resolve) => {
    finishCheck = { started: resolve };
  });
  let resolveCheck;
  const checkResult = new Promise((resolve) => { resolveCheck = resolve; });
  let recoveryAttempts = 0;
  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition: (id, status, options) => recordHublotTransition(state, id, status, options),
    checkService: async () => { finishCheck.started(); return checkResult; },
    recoverTunnel: async () => { recoveryAttempts++; },
    verifyIdentity: () => false,
  });

  const reconciliation = supervisor.reconcile();
  await checkStarted;
  recordHublotTransition(state, hublot.id, "closed", { desiredState: "closed", publicUrl: null, closedAt: "closed" });
  resolveCheck(false);
  const result = await reconciliation;

  assert.equal(result.checked, 1);
  assert.equal(result.recovering, 0);
  assert.equal(recoveryAttempts, 0);
  assert.equal(store.repositories.hublots.find(hublot.id).status, "closed");
  assert.equal(store.repositories.hublots.find(hublot.id).desired_state, "closed");
});

test("supervisor ignores stale health results after concurrent process recovery", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4205, serviceKind: "self_served" });
  recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://live.test" });
  let checkStarted;
  const started = new Promise((resolve) => { checkStarted = resolve; });
  let finishCheck;
  const result = new Promise((resolve) => { finishCheck = resolve; });
  let recoveryAttempts = 0;
  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition: (id, status, options) => recordHublotTransition(state, id, status, options),
    checkService: async () => { checkStarted(); return result; },
    recoverTunnel: async () => { recoveryAttempts++; },
    verifyIdentity: (process) => process.id === "replacement-tunnel",
  });

  const reconciliation = supervisor.reconcile();
  await started;
  processRow(store, hublot.id, "replacement-tunnel", "tunnel");
  finishCheck(false);
  const report = await reconciliation;

  assert.equal(report.checked, 1);
  assert.equal(report.recovering, 0);
  assert.equal(recoveryAttempts, 0);
  assert.equal(store.repositories.hublots.find(hublot.id).status, "open");
  assert.equal(store.repositories.hublots.find(hublot.id).public_url, "https://live.test");
});

test("supervisor does not turn a concurrently closed hublot into a restart failure", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4204, brief: "managed service" });
  recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://restart-race.test" });
  let restartStarted;
  const started = new Promise((resolve) => { restartStarted = resolve; });
  let rejectRestart;
  const restartResult = new Promise((resolve, reject) => { rejectRestart = reject; });
  const messages = [];
  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition: (id, status, options) => recordHublotTransition(state, id, status, options),
    restartService: async () => { restartStarted(); return restartResult; },
    verifyIdentity: () => false,
    logger: { error: (message) => messages.push(message) },
  });

  const reconciliation = supervisor.reconcile();
  await started;
  recordHublotTransition(state, hublot.id, "closed", { desiredState: "closed", publicUrl: null, closedAt: "closed" });
  rejectRestart("spawn failed");
  const result = await reconciliation;
  const closed = store.repositories.hublots.find(hublot.id);

  assert.equal(result.restarted, 0);
  assert.equal(result.crashLooped, 0);
  assert.equal(closed.status, "closed");
  assert.equal(closed.desired_state, "closed");
  assert.equal(closed.restart_count, 0);
  assert.match(messages[0], /spawn failed/);
});

test("failed tunnel recovery does not overwrite a concurrent successful open", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4206, serviceKind: "self_served" });
  recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://old.test" });
  let recoveryStarted;
  const started = new Promise((resolve) => { recoveryStarted = resolve; });
  let rejectRecovery;
  const recovery = new Promise((resolve, reject) => { rejectRecovery = reject; });
  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition: (id, status, options) => recordHublotTransition(state, id, status, options),
    recoverTunnel: async () => { recoveryStarted(); return recovery; },
    verifyIdentity: () => false,
    logger: { error() {} },
  });

  const reconciliation = supervisor.reconcile();
  await started;
  recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://replacement.test" });
  rejectRecovery(new Error("stale recovery failed"));
  const report = await reconciliation;
  const reopened = store.repositories.hublots.find(hublot.id);

  assert.equal(report.crashLooped, 0);
  assert.equal(reopened.status, "open");
  assert.equal(reopened.public_url, "https://replacement.test");
  assert.equal(reopened.restart_count, 0);
  assert.equal(reopened.next_restart_at, null);
});

test("supervisor validates callbacks and timing configuration", (t) => {
  const { store } = fixture(t);
  const base = { appStore: store, recordTransition() {} };

  assert.throws(() => createHublotSupervisor({ ...base, checkService: true }), /service check callback/);
  assert.throws(() => createHublotSupervisor({ ...base, intervalMs: 0 }), /supervisor interval/);
  assert.throws(
    () => createHublotSupervisor({ ...base, restartBaseDelayMs: 20, restartMaxDelayMs: 10 }),
    /maximum delay must not be less/,
  );
  assert.throws(() => createHublotSupervisor({ ...base, restartLimit: 1.5 }), /restart limit/);
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

test("periodic supervisor supports a numeric zero timer handle", (t) => {
  const { store } = fixture(t);
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
  const report = { checked: 2, recoveredTunnels: 2 };
  const reconciliation = new Promise((resolve) => { finishReconciliation = resolve; });
  const state = {
    hublotStartupReconciled: false,
    hublotStartupReconciliationTask: null,
  };
  const supervisor = {
    reconcile(options) { calls.push(`reconcile:${options.includeOpening}:${options.recoverMissing}`); return reconciliation; },
    start() { calls.push("start"); },
  };

  const task = scheduleHublotStartupReconciliation({ state, supervisor });

  assert.deepEqual(calls, ["start"], "scheduling must return before reconciliation starts");
  assert.equal(state.hublotStartupReconciled, false);
  await Promise.resolve();
  assert.deepEqual(calls, ["start", "reconcile:true:false"]);

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
