import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { createSessionDeletionWorkflow } from "../persistence/sessionDeletion.mjs";

test("deleting one session removes all and only its checkpoints, routines, runs, logs, hublots, lifecycle, and runners", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-complete-session-cascade-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const references = {
    a: { backend: "jsonl", id: "session-a", storagePath: "/sessions/a.jsonl" },
    b: { backend: "jsonl", id: "session-b", storagePath: "/sessions/b.jsonl" },
  };
  const owners = Object.fromEntries(Object.entries(references).map(([key, reference]) => [key, store.repositories.sessions.upsert({
    backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath, createdAt: `owner-${key}`,
  })]));

  for (const key of ["a", "b"]) {
    const owner = owners[key];
    const reference = references[key];
    store.repositories.checkpoints.record(reference, {
      hash: `hash-${key}`, anchorId: `anchor-${key}`, sessionRef: reference, timestamp: `checkpoint-${key}`,
    });
    store.repositories.routines.upsert({
      id: `routine-${key}`, ownerId: owner.id, name: `routine-${key}.sh`, script: `echo ${key}`, cwd: `/work/${key}`, now: `routine-${key}`,
    });
    store.repositories.routines.createRun({ id: `run-${key}`, routineId: `routine-${key}`, mode: "run", startedAt: `run-${key}` });
    store.repositories.routines.appendLog(`run-${key}`, "stdout", `log-${key}`, `log-${key}`);
    store.repositories.hublots.create({
      id: `hublot-${key}`, ownerId: owner.id, port: key === "a" ? 4301 : 4302, workdir: `/work/${key}`,
      serviceKind: "self_served", status: "open", desiredState: "open", createdAt: `hublot-${key}`,
    });
    store.repositories.hublots.appendLifecycleEvent({ hublotId: `hublot-${key}`, status: "open", desiredState: "open", createdAt: `event-${key}` });
    store.repositories.hublots.upsertProcess({ id: `process-${key}`, hublotId: `hublot-${key}`, role: "tunnel", pid: 8000 + owner.id, status: "running", startedAt: `process-${key}` });
    store.repositories.runners.create({
      id: `runner-${key}0000`, ownerId: owner.id, dir: `/work/${key}`, sessionBackend: reference.backend,
      sessionId: reference.id, sessionStoragePath: reference.storagePath, desiredState: "stopped", lastStatus: "stopped", createdAt: `runner-${key}`,
    });
    store.repositories.runnerEvents.append({ runnerId: `runner-${key}0000`, sseId: `event-${key}`, payload: `{"session":"${key}"}`, createdAt: `runner-event-${key}` });
  }
  store.repositories.routines.upsert({ id: "routine-global", name: "global.sh", script: "echo global", now: "global" });
  store.repositories.hublots.create({
    id: "hublot-global", port: 4303, workdir: "/global", serviceKind: "self_served",
    status: "closed", desiredState: "closed", createdAt: "global",
  });

  const workflow = createSessionDeletionWorkflow({
    appStore: store,
    ensureSessionOwner: () => owners.a,
    operationId: () => "delete-session-a-complete",
    now: () => "deleted",
  });
  await workflow({
    reference: references.a,
    stopRunners: () => ["runner-a0000"],
    stopRoutines: () => ["routine-a.sh"],
    deleteAgentSession: () => ({ deleted: true }),
    closeHublots: () => [4301],
    deleteRoutines: () => ["routine-a.sh"],
    removeRuntime() {},
    broadcast() {},
  });

  assert.deepEqual(store.repositories.checkpoints.listForSession(references.a), []);
  assert.equal(store.repositories.routines.findByName("routine-a.sh"), null);
  assert.equal(store.repositories.routines.findRun("run-a"), null);
  assert.deepEqual(store.repositories.routines.listLogs("run-a"), []);
  assert.equal(store.repositories.hublots.find("hublot-a"), null);
  assert.deepEqual(store.repositories.hublots.listLifecycleEvents("hublot-a"), []);
  assert.deepEqual(store.repositories.hublots.listProcesses("hublot-a"), []);
  assert.equal(store.repositories.runners.find("runner-a0000"), null);
  assert.deepEqual(store.repositories.runnerEvents.list("runner-a0000"), []);

  assert.equal(store.repositories.checkpoints.listForSession(references.b).length, 1);
  assert.equal(store.repositories.routines.findByName("routine-b.sh").owner_id, owners.b.id);
  assert.equal(store.repositories.routines.findRun("run-b").status, "running");
  assert.deepEqual(store.repositories.routines.listLogs("run-b").map(({ text }) => text), ["log-b"]);
  assert.equal(store.repositories.hublots.find("hublot-b").owner_id, owners.b.id);
  assert.equal(store.repositories.hublots.listLifecycleEvents("hublot-b").length, 1);
  assert.equal(store.repositories.hublots.listProcesses("hublot-b").length, 1);
  assert.equal(store.repositories.runners.find("runner-b0000").owner_id, owners.b.id);
  assert.equal(store.repositories.runnerEvents.list("runner-b0000").length, 1);
  assert.equal(store.repositories.routines.findByName("global.sh").owner_id, null);
  assert.equal(store.repositories.hublots.find("hublot-global").owner_id, null);
});
