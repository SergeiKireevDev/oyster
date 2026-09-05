import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { reserveHublot, spawnGitServerService } from "../server/tunnels.mjs";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-hublot-runtime-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root };
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, state };
}

function writeScript(path, content, mode = 0o755) {
  writeFileSync(path, content, { mode });
  chmodSync(path, mode);
}

test("hublot runtime registry contains only ChildProcess handles keyed by persistent process id", async (t) => {
  const { root, store, state } = await fixture(t);
  const worktreePath = join(root, "worktree");
  const serverPath = join(root, "serve-git-smart-http.sh");
  mkdirSync(worktreePath);
  execFileSync("git", ["init", "--quiet", worktreePath]);
  writeScript(serverPath, "#!/bin/sh\nexit 0\n");
  const hublot = await reserveHublot(state, { port: 4195, brief: "serve" });
  assert.equal(state.hublotProcessHandles, undefined);
  assert.equal(state.tunnels, undefined);

  const serviceProc = new EventEmitter();
  serviceProc.pid = process.pid;
  serviceProc.exitCode = null;
  serviceProc.unref = () => {};

  const service = await spawnGitServerService(state, { id: hublot.id, port: hublot.port }, worktreePath, {
    serverPath,
    spawnProcess: () => serviceProc,
    waitForPort: async () => true,
  });

  assert.equal(state.hublotProcessHandles.size, 1);
  assert.equal(state.hublotProcessHandles.get(service.serviceProcess.id), serviceProc);
  assert.equal(service.serviceProcess.hublot_id, hublot.id);
  assert.equal(service.serviceProcess.role, "service");
  assert.equal(state.tunnels, undefined);
  for (const value of state.hublotProcessHandles.values()) assert.equal(value, serviceProc);

  serviceProc.emit("exit", 0, null);
  let persisted;
  for (let attempt = 0; attempt < 10; attempt++) {
    persisted = await store.repositories.hublots.findProcess(service.serviceProcess.id);
    if (persisted.status === "ended") break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(state.hublotProcessHandles.size, 0);
  assert.equal(persisted.status, "ended");
});
