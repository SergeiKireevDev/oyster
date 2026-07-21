import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import {
  closeSessionHublots, persistHublotProcessIdentity, recordHublotTransition, reserveHublot,
} from "../server/tunnels.mjs";

test("session deletion stops service and tunnel before cascading hublot and startup records", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-delete-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root, hublotProcessHandles: new Map() };
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

  const owner = store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "delete-me", storagePath: "/agent.sqlite", createdAt: "created" });
  const hublot = reserveHublot(state, { port: 4250, brief: "managed preview", sessionId: "delete-me", ownerId: owner.id });
  const source = "#!/bin/sh\nexec node server/server.mjs\n";
  store.repositories.hublots.update(hublot.id, { service_start_script: source, service_start_script_sha256: "hash" });
  mkdirSync(dirname(hublot.service_start_script_path), { recursive: true });
  writeFileSync(hublot.service_start_script_path, source, { mode: 0o700 });
  recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://delete.trycloudflare.com" });
  const tunnel = persistHublotProcessIdentity(state, { hublotId: hublot.id, role: "tunnel", pid: child().pid });
  const service = persistHublotProcessIdentity(state, { hublotId: hublot.id, role: "service", pid: child().pid });
  const alive = new Set([tunnel.id, service.id]);
  const byPid = new Map([tunnel, service].map((row) => [row.pid, row]));
  const signals = [];
  let time = 0;

  const ports = await closeSessionHublots(state, "delete-me", {
    termTimeoutMs: 100,
    killTimeoutMs: 50,
    pollIntervalMs: 25,
    clock: () => time,
    sleep: async (ms) => { time += ms; },
    verifyIdentity: (row) => alive.has(row.id),
    signalProcess(pid, signal) {
      const row = byPid.get(pid);
      signals.push(`${row.role}:${signal}`);
      if (signal === "SIGKILL" || row.role === "tunnel") alive.delete(row.id);
    },
  });
  assert.deepEqual(ports, [4250]);
  assert.deepEqual(signals, ["tunnel:SIGTERM", "service:SIGTERM", "service:SIGKILL"]);
  assert.equal(store.repositories.hublots.find(hublot.id).status, "closed");
  assert.equal(store.repositories.hublots.find(hublot.id).desired_state, "closed");
  assert.equal(store.repositories.hublots.findProcess(tunnel.id).status, "ended");
  assert.equal(store.repositories.hublots.findProcess(service.id).status, "ended");
  assert.equal(existsSync(hublot.service_start_script_path), false, "startup artifact is removed only after processes stop");

  store.repositories.sessions.delete(owner.id);
  assert.equal(store.repositories.hublots.find(hublot.id), null);
  assert.equal(store.repositories.hublots.findProcess(tunnel.id), null);
  assert.deepEqual(store.repositories.hublots.listLifecycleEvents(hublot.id), []);
});
