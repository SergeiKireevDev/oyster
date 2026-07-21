import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { readProcessIdentity } from "../server/persistence/processIdentity.mjs";
import {
  currentHublotTunnelProcessIsHealthy, listTunnels, persistHublotProcessIdentity,
  rebindHublot, recordHublotTransition, reserveHublot, updateHublotProcessMetadata,
} from "../server/tunnels.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-process-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root };
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, state };
}

test("process identity captures PID-reuse-resistant Linux metadata", () => {
  const pid = 321;
  const fields = ["S", "1", "777", ...Array(16).fill("0"), "424242", "0"];
  const stat = `${pid} (command with spaces) ${fields.join(" ")}`;
  const command = Buffer.from("node\0server.mjs\0");
  const identity = readProcessIdentity(pid, {
    readFile(path, encoding) {
      if (path === `/proc/${pid}/stat`) return stat;
      if (path === `/proc/${pid}/cmdline`) return encoding === null ? command : command.toString(encoding);
      if (path === "/proc/sys/kernel/random/boot_id") return "boot-uuid\n";
      throw new Error("missing");
    },
    readlink: () => "/usr/bin/node",
  });
  assert.deepEqual(identity, {
    pid,
    processGroupId: 777,
    bootId: "boot-uuid",
    procStartTicks: "424242",
    executable: "/usr/bin/node",
    commandSha256: createHash("sha256").update(command).digest("hex"),
  });
});

test("discovered hublot processes are persisted immediately with verifiable identity", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4180 });
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  t.after(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} });

  const persisted = persistHublotProcessIdentity(state, {
    hublotId: hublot.id, role: "service", pid: child.pid, startedAt: "spawned",
  });

  assert.equal(persisted.pid, child.pid);
  assert.equal(persisted.role, "service");
  assert.equal(persisted.status, "running");
  assert.equal(persisted.started_at, "spawned");
  assert.ok(persisted.observed_at);
  assert.ok(persisted.boot_id);
  assert.ok(persisted.proc_start_ticks);
  assert.ok(persisted.executable);
  assert.ok(persisted.command_sha256);
  assert.equal(store.repositories.hublots.listProcesses(hublot.id)[0].id, persisted.id);

  const exited = once(child, "exit");
  process.kill(-child.pid, "SIGTERM");
  await exited;
});

test("persisted URLs are published only while the current tunnel identity is healthy", async (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4182 });
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  t.after(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} });
  const tunnelProcess = persistHublotProcessIdentity(state, { hublotId: hublot.id, role: "tunnel", pid: child.pid });
  recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://confirmed.trycloudflare.com" });

  assert.equal(currentHublotTunnelProcessIsHealthy(state, hublot.id), true);
  assert.equal(listTunnels(state)[0].url, "https://confirmed.trycloudflare.com");
  assert.equal(currentHublotTunnelProcessIsHealthy(state, hublot.id, { verifyIdentity: () => false }), false);

  updateHublotProcessMetadata(state, tunnelProcess.id, { status: "lost", ended_at: "lost", observed_at: "lost" });
  assert.equal(store.repositories.hublots.find(hublot.id).public_url, "https://confirmed.trycloudflare.com", "SQLite may retain the last observed URL for history");
  assert.equal(currentHublotTunnelProcessIsHealthy(state, hublot.id), false);
  assert.deepEqual(listTunnels(state), [], "an unconfirmed persisted URL must not be published as an active tunnel");

  const exited = once(child, "exit");
  process.kill(-child.pid, "SIGTERM");
  await exited;
});

test("session rebinding and process metadata updates commit transactionally", async (t) => {
  const { store, state } = fixture(t);
  const ownerA = store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "session-a", storagePath: "/agent.sqlite", createdAt: "a" });
  const ownerB = store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "session-b", storagePath: "/agent.sqlite", createdAt: "b" });
  const hublot = reserveHublot(state, { port: 4181, sessionId: "session-a", ownerId: ownerA.id });

  const rebound = rebindHublot(state, hublot.id, ownerB.id);
  assert.equal(rebound.owner_id, ownerB.id);
  assert.equal(rebound.session_id, "session-b");
  assert.throws(() => rebindHublot(state, hublot.id, 999999), /foreign key constraint/i);
  assert.equal(store.repositories.hublots.find(hublot.id).owner_id, ownerB.id);

  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  t.after(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} });
  const processRow = persistHublotProcessIdentity(state, { hublotId: hublot.id, role: "service", pid: child.pid });
  const ended = updateHublotProcessMetadata(state, processRow.id, {
    status: "ended", observed_at: "observed", ended_at: "ended", exit_code: 0, signal: null,
  });
  assert.equal(ended.status, "ended");
  assert.equal(ended.ended_at, "ended");
  assert.throws(() => updateHublotProcessMetadata(state, processRow.id, { pid: 1 }), /unsupported hublot process field/);
  assert.equal(store.repositories.hublots.findProcess(processRow.id).pid, child.pid);
  assert.equal(store.repositories.hublots.findProcess(processRow.id).status, "ended");
  const exited = once(child, "exit");
  process.kill(-child.pid, "SIGTERM");
  await exited;
});

test("tunnel manager records every spawned or discovered process role", () => {
  const source = readFileSync(new URL("../server/tunnels.mjs", import.meta.url), "utf8");
  for (const role of ["tunnel", "setup_agent", "service"]) {
    assert.match(source, new RegExp(`persistHublotProcessIdentity\\(state, \\{[^}]*role: ["']${role}["']`, "s"));
  }
});
