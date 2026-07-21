import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { invokeHublotStartupScript, reserveHublot, validateAndStoreHublotStartupScript } from "../server/tunnels.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-runtime-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root };
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, state };
}

test("hublot runtime registry contains only ChildProcess handles keyed by persistent process id", (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4195, brief: "serve" });
  const script = "#!/bin/sh\n# oyster: idempotent\nexit 0\n";
  mkdirSync(dirname(hublot.service_start_script_path), { recursive: true });
  writeFileSync(hublot.service_start_script_path, script, { mode: 0o700 });
  chmodSync(hublot.service_start_script_path, 0o700);
  validateAndStoreHublotStartupScript(state, { id: hublot.id, serviceStartScriptPath: hublot.service_start_script_path });
  assert.equal(state.hublotProcessHandles, undefined);
  assert.equal(state.tunnels, undefined);

  const childProcess = new EventEmitter();
  childProcess.pid = process.pid;
  const invoked = invokeHublotStartupScript(state, hublot.id, { spawnProcess: () => childProcess });

  assert.equal(state.hublotProcessHandles.size, 1);
  assert.equal(state.hublotProcessHandles.get(invoked.process.id), childProcess);
  assert.equal(invoked.process.hublot_id, hublot.id);
  assert.equal(invoked.process.role, "setup_agent");
  assert.equal(state.tunnels, undefined);
  for (const value of state.hublotProcessHandles.values()) assert.equal(value, childProcess);

  childProcess.emit("exit", 0, null);
  assert.equal(state.hublotProcessHandles.size, 0);
  assert.equal(store.repositories.hublots.findProcess(invoked.process.id).status, "ended");
});
