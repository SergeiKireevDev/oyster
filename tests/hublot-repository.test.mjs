import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-repository-"));
  const path = join(root, "app.sqlite");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return path;
}

function createOwner(store, sessionId = "session-a") {
  return store.repositories.sessions.upsert({ backend: "sqlite", sessionId, storagePath: "/agent.sqlite", createdAt: "owner-created" });
}

function createHublot(store, ownerId) {
  return store.repositories.hublots.create({
    id: "hublot-1",
    ownerId,
    port: 4173,
    label: "preview",
    brief: "serve the preview",
    workdir: "/workspace/project",
    serviceKind: "agent_managed",
    serviceStartScriptPath: "/runtime/hublots/hublot-1/start.sh",
    serviceStartScript: "#!/bin/sh\nexec server\n",
    serviceStartScriptSha256: "abc123",
    publicUrl: "https://first.trycloudflare.com",
    status: "open",
    desiredState: "open",
    restartCount: 2,
    nextRestartAt: "next-restart",
    createdAt: "created",
    openedAt: "opened",
    lastError: "previous failure",
  });
}

test("hublot repository persists authoritative configuration, state, processes, and history", (t) => {
  const path = fixture(t);
  let store = openAppStore({ databasePath: path });
  const owner = createOwner(store);
  const created = createHublot(store, owner.id);
  assert.equal(created.session_id, "session-a");
  assert.equal(created.service_start_script, "#!/bin/sh\nexec server\n");
  assert.equal(created.desired_state, "open");

  assert.equal(store.repositories.hublots.appendLifecycleEvent({ hublotId: created.id, status: "opening", desiredState: "open", createdAt: "event-1" }), 1);
  assert.equal(store.repositories.hublots.appendLifecycleEvent({ hublotId: created.id, status: "open", desiredState: "open", publicUrl: created.public_url, createdAt: "event-2" }), 2);

  for (const [index, role] of ["service", "tunnel", "setup_agent"].entries()) {
    const process = store.repositories.hublots.upsertProcess({
      id: `process-${role}`,
      hublotId: created.id,
      role,
      pid: 2000 + index,
      processGroupId: 1900 + index,
      bootId: "boot-id",
      procStartTicks: String(5000 + index),
      executable: role === "tunnel" ? "/usr/bin/cloudflared" : "/usr/bin/node",
      commandSha256: `command-${role}`,
      status: "running",
      startedAt: `started-${index}`,
      observedAt: `observed-${index}`,
    });
    assert.equal(process.role, role);
  }

  assert.equal(store.repositories.hublots.update(created.id, {
    public_url: null,
    status: "recovering",
    desired_state: "open",
    restart_count: 3,
    next_restart_at: "retry-at",
    last_error: "tunnel exited",
    closed_at: "temporarily-closed",
  }), 1);
  store.close();

  store = openAppStore({ databasePath: path });
  const restored = store.repositories.hublots.find(created.id);
  assert.equal(restored.owner_id, owner.id);
  assert.equal(restored.session_id, "session-a");
  assert.equal(restored.port, 4173);
  assert.equal(restored.label, "preview");
  assert.equal(restored.brief, "serve the preview");
  assert.equal(restored.workdir, "/workspace/project");
  assert.equal(restored.service_kind, "agent_managed");
  assert.equal(restored.service_start_script_path, "/runtime/hublots/hublot-1/start.sh");
  assert.equal(restored.service_start_script_sha256, "abc123");
  assert.equal(restored.public_url, null);
  assert.equal(restored.status, "recovering");
  assert.equal(restored.desired_state, "open");
  assert.equal(restored.restart_count, 3);
  assert.equal(restored.next_restart_at, "retry-at");
  assert.equal(restored.created_at, "created");
  assert.equal(restored.opened_at, "opened");
  assert.equal(restored.closed_at, "temporarily-closed");
  assert.equal(restored.last_error, "tunnel exited");
  assert.deepEqual(store.hydrate().hublots, [restored]);

  assert.deepEqual(store.repositories.hublots.listLifecycleEvents(created.id).map((event) => [event.sequence, event.status]), [[1, "opening"], [2, "open"]]);
  assert.deepEqual(store.repositories.hublots.listProcesses(created.id).map((process) => process.role).sort(), ["service", "setup_agent", "tunnel"]);
  store.close();
});

test("hublot ownership cascades process identity and lifecycle history", (t) => {
  const path = fixture(t);
  const store = openAppStore({ databasePath: path });
  t.after(() => store.close());
  const owner = createOwner(store);
  const hublot = createHublot(store, owner.id);
  store.repositories.hublots.appendLifecycleEvent({ hublotId: hublot.id, status: "open", desiredState: "open", createdAt: "event" });
  store.repositories.hublots.upsertProcess({ id: "tunnel-process", hublotId: hublot.id, role: "tunnel", pid: 1234, status: "running", startedAt: "started" });

  store.repositories.sessions.delete(owner.id);

  assert.equal(store.repositories.hublots.find(hublot.id), null);
  assert.deepEqual(store.repositories.hublots.listLifecycleEvents(hublot.id), []);
  assert.deepEqual(store.repositories.hublots.listProcesses(hublot.id), []);
});

test("hublot schema rejects invalid durable state", (t) => {
  const path = fixture(t);
  const store = openAppStore({ databasePath: path });
  t.after(() => store.close());
  assert.throws(() => store.repositories.hublots.create({
    id: "invalid", port: 0, workdir: "/workspace", serviceKind: "unknown",
    status: "open", desiredState: "maybe", createdAt: "created",
  }), /constraint/i);
});
