import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { readProcessIdentity } from "../persistence/processIdentity.mjs";
import { persistHublotProcessIdentity, reserveHublot } from "../tunnels.mjs";

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

test("tunnel manager records every spawned or discovered process role", () => {
  const source = readFileSync(new URL("../tunnels.mjs", import.meta.url), "utf8");
  for (const role of ["tunnel", "setup_agent", "service"]) {
    assert.match(source, new RegExp(`persistHublotProcessIdentity\\(state, \\{[^}]*role: ["']${role}["']`, "s"));
  }
});
