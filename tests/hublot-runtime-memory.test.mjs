import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { reserveHublot, openTunnel } from "../server/tunnels.mjs";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-hublot-runtime-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { TUNNEL_BIN: "cloudflared", SKIP_PUBLIC_HUBLOT_READINESS: true }, serverEvent() {}, currentDir: root };
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, state };
}

test("hublot runtime registry contains only ChildProcess handles keyed by persistent process id", async (t) => {
  const { root, store, state } = await fixture(t);
  const hublot = await reserveHublot(state, { port: 4195, brief: "serve" });
  assert.equal(state.hublotProcessHandles, undefined);
  assert.equal(state.tunnels, undefined);

  const serviceProc = Object.assign(new EventEmitter(), {
    pid: process.pid, exitCode: null, stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {},
  });
  const opening = openTunnel(state, { id: hublot.id, port: hublot.port }, { spawnProcess: () => serviceProc });
  while (!serviceProc.stderr.listenerCount("data")) await new Promise((resolve) => setImmediate(resolve));
  serviceProc.stderr.emit("data", "https://runtime.trycloudflare.com");
  await opening;
  const [processRow] = await store.repositories.hublots.listProcesses(hublot.id);

  assert.equal(state.hublotProcessHandles.size, 1);
  assert.equal(state.hublotProcessHandles.get(processRow.id), serviceProc);
  assert.equal(processRow.hublot_id, hublot.id);
  assert.equal(processRow.role, "tunnel");
  assert.equal(state.tunnels, undefined);
  for (const value of state.hublotProcessHandles.values()) assert.equal(value, serviceProc);

  serviceProc.exitCode = 0;
  serviceProc.emit("exit", 0, null);
  let persisted;
  for (let attempt = 0; attempt < 10; attempt++) {
    persisted = await store.repositories.hublots.findProcess(processRow.id);
    if (persisted.status === "ended" && (await store.repositories.hublots.find(hublot.id)).status === "interrupted") break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(state.hublotProcessHandles.size, 0);
  assert.equal(persisted.status, "ended");
});
