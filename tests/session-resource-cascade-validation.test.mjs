import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { createSessionDeletionWorkflow } from "../persistence/sessionDeletion.mjs";
import { reconcileSessionDeletions } from "../persistence/sessionDeletionReconciler.mjs";

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

test("failed agent deletion preserves every owned durable resource and skips destructive callbacks", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-failed-agent-preservation-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const reference = { backend: "sqlite", id: "session-failed", storagePath: "/sessions/agent.sqlite" };
  const owner = store.repositories.sessions.upsert({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath, createdAt: "owner" });
  store.repositories.checkpoints.record(reference, { hash: "hash", anchorId: "anchor", sessionRef: reference, timestamp: "checkpoint" });
  store.repositories.routines.upsert({ id: "routine-failed", ownerId: owner.id, name: "failed.sh", script: "echo preserved", cwd: "/work", now: "routine" });
  store.repositories.routines.createRun({ id: "run-failed", routineId: "routine-failed", mode: "run", startedAt: "run" });
  store.repositories.routines.updateProgress("run-failed", 55, "preserve me");
  store.repositories.routines.appendLog("run-failed", "stdout", "durable log", "logged");
  store.repositories.hublots.create({
    id: "hublot-failed", ownerId: owner.id, port: 4310, workdir: "/work", serviceKind: "self_served",
    status: "open", desiredState: "open", publicUrl: "https://preserved.test", createdAt: "hublot",
  });
  store.repositories.hublots.appendLifecycleEvent({ hublotId: "hublot-failed", status: "open", desiredState: "open", publicUrl: "https://preserved.test", createdAt: "event" });
  store.repositories.hublots.upsertProcess({ id: "process-failed", hublotId: "hublot-failed", role: "tunnel", pid: 8310, status: "running", startedAt: "process" });
  store.repositories.runners.create({
    id: "runner-failed0", ownerId: owner.id, dir: "/work", sessionBackend: reference.backend, sessionId: reference.id,
    sessionStoragePath: reference.storagePath, desiredState: "stopped", lastStatus: "stopped", createdAt: "runner",
  });
  store.repositories.runnerEvents.append({ runnerId: "runner-failed0", sseId: "runner-event", payload: '{"preserved":true}', createdAt: "runner-event" });
  const snapshot = () => ({
    checkpoints: store.repositories.checkpoints.listForSession(reference),
    routine: store.repositories.routines.findByName("failed.sh"),
    run: store.repositories.routines.findRun("run-failed"),
    logs: store.repositories.routines.listLogs("run-failed"),
    hublot: store.repositories.hublots.find("hublot-failed"),
    history: store.repositories.hublots.listLifecycleEvents("hublot-failed"),
    processes: store.repositories.hublots.listProcesses("hublot-failed"),
    runner: store.repositories.runners.find("runner-failed0"),
    replay: store.repositories.runnerEvents.list("runner-failed0"),
  });
  const before = snapshot();
  const destructiveCalls = [];
  const workflow = createSessionDeletionWorkflow({
    appStore: store, ensureSessionOwner: () => owner, operationId: () => "failed-agent-delete", now: () => "failed",
  });

  await assert.rejects(() => workflow({
    reference,
    stopRunners: () => ["runner-failed0"],
    stopRoutines: () => ["failed.sh"],
    deleteAgentSession: () => { throw new Error("agent store refused deletion"); },
    closeHublots: () => destructiveCalls.push("hublots"),
    deleteRoutines: () => destructiveCalls.push("routines"),
    removeRuntime: () => destructiveCalls.push("runtime"),
    broadcast: () => destructiveCalls.push("broadcast"),
  }), /agent store refused deletion/);

  assert.deepEqual(snapshot(), before);
  assert.deepEqual(destructiveCalls, []);
  assert.equal(store.repositories.sessions.find({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath }).status, "deleting");
  const operation = store.repositories.operations.find("failed-agent-delete");
  assert.equal(operation.status, "failed");
  assert.equal(operation.owner_id, owner.id);
});

test("restart completes the owned-resource cascade after a crash following agent deletion", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-post-agent-delete-crash-"));
  const databasePath = join(root, "app.sqlite");
  let store = openAppStore({ databasePath });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const reference = { backend: "sqlite", id: "deleted-agent-session", storagePath: "/sessions/agent.sqlite" };
  const survivorReference = { backend: "sqlite", id: "survivor", storagePath: reference.storagePath };
  const owner = store.repositories.sessions.upsert({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath, createdAt: "owner" });
  store.repositories.sessions.upsert({ backend: survivorReference.backend, sessionId: survivorReference.id, storagePath: survivorReference.storagePath, createdAt: "survivor" });
  store.repositories.checkpoints.record(reference, { hash: "deleted-hash", anchorId: "deleted-anchor", sessionRef: reference, timestamp: "checkpoint" });
  store.repositories.checkpoints.record(survivorReference, { hash: "survivor-hash", anchorId: "survivor-anchor", sessionRef: survivorReference, timestamp: "survivor-checkpoint" });
  store.repositories.routines.upsert({ id: "crashed-routine", ownerId: owner.id, name: "crashed.sh", script: "echo crashed", now: "routine" });
  store.repositories.routines.createRun({ id: "crashed-run", routineId: "crashed-routine", mode: "run", startedAt: "run" });
  store.repositories.routines.appendLog("crashed-run", "stdout", "crashed log", "log");
  store.repositories.hublots.create({ id: "crashed-hublot", ownerId: owner.id, port: 4320, workdir: "/work", serviceKind: "self_served", status: "open", desiredState: "open", createdAt: "hublot" });
  store.repositories.hublots.appendLifecycleEvent({ hublotId: "crashed-hublot", status: "open", desiredState: "open", createdAt: "event" });
  store.repositories.sessions.markDeleting(owner.id);
  store.repositories.operations.create({
    id: "post-agent-delete", ownerId: owner.id, kind: "delete_session", status: "running", stage: "agent_deleted",
    payload: JSON.stringify({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath }), createdAt: "before-crash",
  });
  store.close();

  store = openAppStore({ databasePath });
  assert.equal(store.reconcileInterruptedOperations("restart"), 1);
  let agentDeleteCalls = 0;
  const cleanupOrder = [];
  const results = await reconcileSessionDeletions({
    appStore: store,
    sessionReferences: { validate: (value) => value },
    sessionCatalog: { backend: "sqlite", findById: () => null },
    sessionOperations: {
      capabilities: { delete: { sqlite: true } },
      deleteSession: async () => { agentDeleteCalls++; },
    },
    closeSessionHublots: async (sessionId) => { cleanupOrder.push(`hublots:${sessionId}`); },
    deleteSessionRoutines: async (sessionId) => { cleanupOrder.push(`routines:${sessionId}`); },
    now: () => "reconciled",
  });

  assert.deepEqual(results, [{ id: "post-agent-delete", status: "completed" }]);
  assert.equal(agentDeleteCalls, 0, "already-deleted agent session is not deleted a second time");
  assert.deepEqual(cleanupOrder, ["hublots:deleted-agent-session", "routines:deleted-agent-session"]);
  assert.equal(store.repositories.sessions.find({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath }), null);
  assert.deepEqual(store.repositories.checkpoints.listForSession(reference), []);
  assert.equal(store.repositories.routines.findByName("crashed.sh"), null);
  assert.equal(store.repositories.routines.findRun("crashed-run"), null);
  assert.deepEqual(store.repositories.routines.listLogs("crashed-run"), []);
  assert.equal(store.repositories.hublots.find("crashed-hublot"), null);
  assert.deepEqual(store.repositories.hublots.listLifecycleEvents("crashed-hublot"), []);
  assert.equal(store.repositories.checkpoints.listForSession(survivorReference).length, 1);
  const operation = store.repositories.operations.find("post-agent-delete");
  assert.equal(operation.status, "completed");
  assert.equal(operation.stage, "completed");
  assert.equal(operation.owner_id, null);
});

test("fork deletion removes fork-owned rows without deleting ancestor-owned resources", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-fork-resource-isolation-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const storagePath = "/sessions/family.sqlite";
  const ancestorRef = { backend: "sqlite", id: "ancestor", storagePath };
  const forkRef = { backend: "sqlite", id: "fork", storagePath };
  const ancestor = store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "ancestor", storagePath, createdAt: "ancestor" });
  const fork = store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "fork", storagePath, createdAt: "fork" });
  for (const [kind, owner, reference, port] of [["ancestor", ancestor, ancestorRef, 4330], ["fork", fork, forkRef, 4331]]) {
    store.repositories.checkpoints.record(reference, { hash: `${kind}-hash`, anchorId: `${kind}-anchor`, sessionRef: reference, timestamp: `${kind}-checkpoint` });
    store.repositories.routines.upsert({ id: `${kind}-routine`, ownerId: owner.id, name: `${kind}.sh`, script: `echo ${kind}`, now: `${kind}-routine` });
    store.repositories.routines.createRun({ id: `${kind}-run`, routineId: `${kind}-routine`, mode: "run", startedAt: `${kind}-run` });
    store.repositories.routines.appendLog(`${kind}-run`, "stdout", `${kind}-log`, `${kind}-log`);
    store.repositories.hublots.create({ id: `${kind}-hublot`, ownerId: owner.id, port, workdir: `/${kind}`, serviceKind: "self_served", status: "open", desiredState: "open", createdAt: `${kind}-hublot` });
    store.repositories.hublots.appendLifecycleEvent({ hublotId: `${kind}-hublot`, status: "open", desiredState: "open", createdAt: `${kind}-event` });
    store.repositories.runners.create({ id: `${kind}-runner0`, ownerId: owner.id, dir: `/${kind}`, sessionBackend: "sqlite", sessionId: reference.id, sessionStoragePath: storagePath, desiredState: "stopped", lastStatus: "stopped", createdAt: `${kind}-runner` });
  }
  const ancestorSnapshot = {
    checkpoints: store.repositories.checkpoints.listForSession(ancestorRef),
    routine: store.repositories.routines.findByName("ancestor.sh"),
    run: store.repositories.routines.findRun("ancestor-run"),
    logs: store.repositories.routines.listLogs("ancestor-run"),
    hublot: store.repositories.hublots.find("ancestor-hublot"),
    history: store.repositories.hublots.listLifecycleEvents("ancestor-hublot"),
    runner: store.repositories.runners.find("ancestor-runner0"),
  };
  const workflow = createSessionDeletionWorkflow({ appStore: store, ensureSessionOwner: () => fork, operationId: () => "delete-fork", now: () => "deleted" });
  await workflow({
    reference: forkRef,
    stopRunners: () => ["fork-runner0"], stopRoutines: () => ["fork.sh"],
    deleteAgentSession: () => ({ deleted: "fork" }),
    closeHublots: () => [4331], deleteRoutines: () => ["fork.sh"], removeRuntime() {}, broadcast() {},
  });

  assert.equal(store.repositories.sessions.find({ backend: "sqlite", sessionId: "fork", storagePath }), null);
  assert.deepEqual(store.repositories.checkpoints.listForSession(forkRef), []);
  assert.equal(store.repositories.routines.findByName("fork.sh"), null);
  assert.equal(store.repositories.hublots.find("fork-hublot"), null);
  assert.equal(store.repositories.runners.find("fork-runner0"), null);
  assert.ok(store.repositories.sessions.find({ backend: "sqlite", sessionId: "ancestor", storagePath }));
  assert.deepEqual({
    checkpoints: store.repositories.checkpoints.listForSession(ancestorRef),
    routine: store.repositories.routines.findByName("ancestor.sh"),
    run: store.repositories.routines.findRun("ancestor-run"),
    logs: store.repositories.routines.listLogs("ancestor-run"),
    hublot: store.repositories.hublots.find("ancestor-hublot"),
    history: store.repositories.hublots.listLifecycleEvents("ancestor-hublot"),
    runner: store.repositories.runners.find("ancestor-runner0"),
  }, ancestorSnapshot);
});
