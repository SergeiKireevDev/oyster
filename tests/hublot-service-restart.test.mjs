import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

test("dead desired-open service executes its persisted script, persists its new PID, then reopens its tunnel", async (t) => {
  const { store, state } = fixture(t);
  const id = "persisted-script-recovery";
  const scriptPath = join(state.config.PI_AGENT_DIR, "hublots", id, "start.sh");
  const pidPath = join(state.config.PI_AGENT_DIR, "hublots", id, "service.pid");
  const port = 4238;
  const script = `#!/bin/sh\n# pi-lot-ui: idempotent\n${JSON.stringify(process.execPath)} -e 'require("node:http").createServer((q,s)=>s.end("ok")).listen(${port},"127.0.0.1")' >/dev/null 2>&1 &\necho $! > ${JSON.stringify(pidPath)}\n`;
  mkdirSync(join(state.config.PI_AGENT_DIR, "hublots", id), { recursive: true });
  writeFileSync(scriptPath, script, { mode: 0o700 });
  chmodSync(scriptPath, 0o700);
  const hublot = store.repositories.hublots.create({
    id, port, workdir: state.currentDir, serviceKind: "agent_managed",
    serviceStartScriptPath: scriptPath, serviceStartScript: script,
    serviceStartScriptSha256: createHash("sha256").update(script).digest("hex"),
    status: "recovering", desiredState: "open", createdAt: "created",
  });
  store.repositories.hublots.upsertProcess({
    id: "dead-service", hublotId: id, role: "service", pid: 999999,
    processGroupId: 999999, bootId: "old-boot", procStartTicks: "1", executable: "/usr/bin/node",
    commandSha256: "old-command", status: "lost", startedAt: "old", endedAt: "dead",
  });
  let servicePid = null;
  t.after(() => { if (servicePid) try { process.kill(servicePid, "SIGKILL"); } catch {} });

  const result = await restartHublotService(state, hublot, {
    discoverPids() {
      servicePid = Number(readFileSync(pidPath, "utf8"));
      return [servicePid];
    },
    persistProcess: persistHublotProcessIdentity,
    async reopenTunnel(targetState, options) {
      const service = store.repositories.hublots.listProcesses(options.id)
        .find((row) => row.role === "service" && row.pid === servicePid && row.status === "running");
      assert.ok(service, "replacement PID is durable before tunnel reopening");
      persistHublotProcessIdentity(targetState, { hublotId: options.id, role: "tunnel", pid: process.pid });
      recordHublotTransition(targetState, options.id, "open", { publicUrl: "https://restarted.test", openedAt: "reopened" });
      return { id: options.id, url: "https://restarted.test" };
    },
  });

  assert.equal(result.servicePid, servicePid);
  assert.notEqual(result.servicePid, 999999);
  assert.equal(readFileSync(scriptPath, "utf8"), script);
  const persistedService = store.repositories.hublots.findProcess(result.serviceProcess.id);
  assert.equal(persistedService.pid, servicePid);
  assert.ok(persistedService.boot_id);
  assert.ok(persistedService.proc_start_ticks);
  assert.equal(store.repositories.hublots.find(id).public_url, "https://restarted.test");
  assert.ok(store.repositories.hublots.listProcesses(id).some((row) => row.role === "tunnel" && row.status === "running"));
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

test("missing self-served services without startup scripts become actionable interruptions", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4236, serviceKind: "self_served" });
  recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://stale-self.test" });
  persistHublotProcessIdentity(state, { hublotId: hublot.id, role: "tunnel", pid: process.pid });
  let restartAttempts = 0;
  let recoveryChecks = 0;
  const supervisor = createHublotSupervisor({
    appStore: store,
    recordTransition: (id, status, options) => recordHublotTransition(state, id, status, options),
    verifyIdentity: (row) => row.role === "tunnel",
    checkService: async () => { recoveryChecks++; return false; },
    recoverTunnel: async () => { throw new Error("missing self-served services must not be tunneled"); },
    restartService: async () => { restartAttempts++; },
    now: () => "observed",
  });

  const result = await supervisor.reconcile();
  const interrupted = store.repositories.hublots.find(hublot.id);
  assert.equal(result.interrupted, 1);
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.desired_state, "open");
  assert.equal(interrupted.public_url, null);
  assert.match(interrupted.last_error, /self-served service is not answering on port 4236/);
  assert.match(interrupted.last_error, /restart it manually/);
  assert.equal(interrupted.service_start_script, null);
  assert.equal(restartAttempts, 0);

  const historyLength = store.repositories.hublots.listLifecycleEvents(hublot.id).length;
  await supervisor.reconcile();
  assert.equal(recoveryChecks, 2, "interrupted self-served services remain eligible for manual recovery");
  assert.equal(store.repositories.hublots.listLifecycleEvents(hublot.id).length, historyLength, "unchanged interruption must not churn history");
  assert.equal(restartAttempts, 0);
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
