import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { createSessionDeletionWorkflow } from "../server/persistence/sessionDeletion.mjs";
import { reconcileSessionDeletions } from "../server/persistence/sessionDeletionReconciler.mjs";

test("deleting one session removes all and only its checkpoints, routines, runs, logs, hublots, lifecycle, and runners", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-complete-session-cascade-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const references = {
    a: { backend: "jsonl", id: "session-a", storagePath: "/sessions/a.jsonl" },
    b: { backend: "jsonl", id: "session-b", storagePath: "/sessions/b.jsonl" },
  };
  const owners = Object.fromEntries(await Promise.all(Object.entries(references).map(async ([key, reference]) => [key, await store.repositories.sessions.upsert({
    backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath, createdAt: `owner-${key}`,
  })])));

  for (const key of ["a", "b"]) {
    const owner = owners[key];
    const reference = references[key];
    await store.repositories.checkpoints.record(reference, {
      hash: `hash-${key}`, anchorId: `anchor-${key}`, sessionRef: reference, timestamp: `checkpoint-${key}`,
    });
    await store.repositories.routines.upsert({
      id: `routine-${key}`, ownerId: owner.id, name: `routine-${key}.sh`, script: `echo ${key}`, cwd: `/work/${key}`, now: `routine-${key}`,
    });
    await store.repositories.routines.createRun({ id: `run-${key}`, routineId: `routine-${key}`, mode: "run", startedAt: `run-${key}` });
    await store.repositories.routines.appendLog(`run-${key}`, "stdout", `log-${key}`, `log-${key}`);
    await store.repositories.hublots.create({
      id: `hublot-${key}`, ownerId: owner.id, port: key === "a" ? 4301 : 4302, workdir: `/work/${key}`,
      serviceKind: "self_served", status: "open", desiredState: "open", createdAt: `hublot-${key}`,
    });
    await store.repositories.hublots.appendLifecycleEvent({ hublotId: `hublot-${key}`, status: "open", desiredState: "open", createdAt: `event-${key}` });
    await store.repositories.hublots.upsertProcess({ id: `process-${key}`, hublotId: `hublot-${key}`, role: "tunnel", pid: 8000 + owner.id, status: "running", startedAt: `process-${key}` });
    await store.repositories.runners.create({
      id: `runner-${key}0000`, ownerId: owner.id, dir: `/work/${key}`, sessionBackend: reference.backend,
      sessionId: reference.id, sessionStoragePath: reference.storagePath, desiredState: "stopped", lastStatus: "stopped", createdAt: `runner-${key}`,
    });
    await store.repositories.runnerEvents.append({ runnerId: `runner-${key}0000`, sseId: `event-${key}`, payload: `{"session":"${key}"}`, createdAt: `runner-event-${key}` });
  }
  await store.repositories.routines.upsert({ id: "routine-global", name: "global.sh", script: "echo global", now: "global" });
  await store.repositories.hublots.create({
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

  assert.deepEqual(await store.repositories.checkpoints.listForSession(references.a), []);
  assert.equal(await store.repositories.routines.findByName("routine-a.sh"), null);
  assert.equal(await store.repositories.routines.findRun("run-a"), null);
  assert.deepEqual(await store.repositories.routines.listLogs("run-a"), []);
  assert.equal(await store.repositories.hublots.find("hublot-a"), null);
  assert.deepEqual(await store.repositories.hublots.listLifecycleEvents("hublot-a"), []);
  assert.deepEqual(await store.repositories.hublots.listProcesses("hublot-a"), []);
  assert.equal(await store.repositories.runners.find("runner-a0000"), null);
  assert.deepEqual(await store.repositories.runnerEvents.list("runner-a0000"), []);

  assert.equal((await store.repositories.checkpoints.listForSession(references.b)).length, 1);
  assert.equal((await store.repositories.routines.findByName("routine-b.sh")).owner_id, owners.b.id);
  assert.equal((await store.repositories.routines.findRun("run-b")).status, "running");
  assert.deepEqual((await store.repositories.routines.listLogs("run-b")).map(({ text }) => text), ["log-b"]);
  assert.equal((await store.repositories.hublots.find("hublot-b")).owner_id, owners.b.id);
  assert.equal((await store.repositories.hublots.listLifecycleEvents("hublot-b")).length, 1);
  assert.equal((await store.repositories.hublots.listProcesses("hublot-b")).length, 1);
  assert.equal((await store.repositories.runners.find("runner-b0000")).owner_id, owners.b.id);
  assert.equal((await store.repositories.runnerEvents.list("runner-b0000")).length, 1);
  assert.equal((await store.repositories.routines.findByName("global.sh")).owner_id, null);
  assert.equal((await store.repositories.hublots.find("hublot-global")).owner_id, null);
});

test("failed agent deletion preserves every owned durable resource and skips destructive callbacks", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-failed-agent-preservation-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const reference = { backend: "sqlite", id: "session-failed", storagePath: "/sessions/agent.sqlite" };
  const owner = await store.repositories.sessions.upsert({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath, createdAt: "owner" });
  await store.repositories.checkpoints.record(reference, { hash: "hash", anchorId: "anchor", sessionRef: reference, timestamp: "checkpoint" });
  await store.repositories.routines.upsert({ id: "routine-failed", ownerId: owner.id, name: "failed.sh", script: "echo preserved", cwd: "/work", now: "routine" });
  await store.repositories.routines.createRun({ id: "run-failed", routineId: "routine-failed", mode: "run", startedAt: "run" });
  await store.repositories.routines.updateProgress("run-failed", 55, "preserve me");
  await store.repositories.routines.appendLog("run-failed", "stdout", "durable log", "logged");
  await store.repositories.hublots.create({
    id: "hublot-failed", ownerId: owner.id, port: 4310, workdir: "/work", serviceKind: "self_served",
    status: "open", desiredState: "open", publicUrl: "https://preserved.test", createdAt: "hublot",
  });
  await store.repositories.hublots.appendLifecycleEvent({ hublotId: "hublot-failed", status: "open", desiredState: "open", publicUrl: "https://preserved.test", createdAt: "event" });
  await store.repositories.hublots.upsertProcess({ id: "process-failed", hublotId: "hublot-failed", role: "tunnel", pid: 8310, status: "running", startedAt: "process" });
  await store.repositories.runners.create({
    id: "runner-failed0", ownerId: owner.id, dir: "/work", sessionBackend: reference.backend, sessionId: reference.id,
    sessionStoragePath: reference.storagePath, desiredState: "stopped", lastStatus: "stopped", createdAt: "runner",
  });
  await store.repositories.runnerEvents.append({ runnerId: "runner-failed0", sseId: "runner-event", payload: '{"preserved":true}', createdAt: "runner-event" });
  const snapshot = async () => ({
    checkpoints: await store.repositories.checkpoints.listForSession(reference),
    routine: await store.repositories.routines.findByName("failed.sh"),
    run: await store.repositories.routines.findRun("run-failed"),
    logs: await store.repositories.routines.listLogs("run-failed"),
    hublot: await store.repositories.hublots.find("hublot-failed"),
    history: await store.repositories.hublots.listLifecycleEvents("hublot-failed"),
    processes: await store.repositories.hublots.listProcesses("hublot-failed"),
    runner: await store.repositories.runners.find("runner-failed0"),
    replay: await store.repositories.runnerEvents.list("runner-failed0"),
  });
  const before = await snapshot();
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

  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(destructiveCalls, []);
  assert.equal((await store.repositories.sessions.find({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath })).status, "deleting");
  const operation = await store.repositories.operations.find("failed-agent-delete");
  assert.equal(operation.status, "failed");
  assert.equal(operation.owner_id, owner.id);
});

test("restart completes the owned-resource cascade after a crash following agent deletion", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-post-agent-delete-crash-"));
  const databasePath = join(root, "app.sqlite");
  let store = await openAppStore({ databasePath });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const reference = { backend: "sqlite", id: "deleted-agent-session", storagePath: "/sessions/agent.sqlite" };
  const survivorReference = { backend: "sqlite", id: "survivor", storagePath: reference.storagePath };
  const owner = await store.repositories.sessions.upsert({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath, createdAt: "owner" });
  await store.repositories.sessions.upsert({ backend: survivorReference.backend, sessionId: survivorReference.id, storagePath: survivorReference.storagePath, createdAt: "survivor" });
  await store.repositories.checkpoints.record(reference, { hash: "deleted-hash", anchorId: "deleted-anchor", sessionRef: reference, timestamp: "checkpoint" });
  await store.repositories.checkpoints.record(survivorReference, { hash: "survivor-hash", anchorId: "survivor-anchor", sessionRef: survivorReference, timestamp: "survivor-checkpoint" });
  await store.repositories.routines.upsert({ id: "crashed-routine", ownerId: owner.id, name: "crashed.sh", script: "echo crashed", now: "routine" });
  await store.repositories.routines.createRun({ id: "crashed-run", routineId: "crashed-routine", mode: "run", startedAt: "run" });
  await store.repositories.routines.appendLog("crashed-run", "stdout", "crashed log", "log");
  await store.repositories.hublots.create({ id: "crashed-hublot", ownerId: owner.id, port: 4320, workdir: "/work", serviceKind: "self_served", status: "open", desiredState: "open", createdAt: "hublot" });
  await store.repositories.hublots.appendLifecycleEvent({ hublotId: "crashed-hublot", status: "open", desiredState: "open", createdAt: "event" });
  await store.repositories.sessions.markDeleting(owner.id);
  await store.repositories.operations.create({
    id: "post-agent-delete", ownerId: owner.id, kind: "delete_session", status: "running", stage: "agent_deleted",
    payload: JSON.stringify({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath }), createdAt: "before-crash",
  });
  await store.close();

  store = await openAppStore({ databasePath });
  assert.equal(await store.reconcileInterruptedOperations("restart"), 1);
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
  assert.equal(await store.repositories.sessions.find({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath }), null);
  assert.deepEqual(await store.repositories.checkpoints.listForSession(reference), []);
  assert.equal(await store.repositories.routines.findByName("crashed.sh"), null);
  assert.equal(await store.repositories.routines.findRun("crashed-run"), null);
  assert.deepEqual(await store.repositories.routines.listLogs("crashed-run"), []);
  assert.equal(await store.repositories.hublots.find("crashed-hublot"), null);
  assert.deepEqual(await store.repositories.hublots.listLifecycleEvents("crashed-hublot"), []);
  assert.equal((await store.repositories.checkpoints.listForSession(survivorReference)).length, 1);
  const operation = await store.repositories.operations.find("post-agent-delete");
  assert.equal(operation.status, "completed");
  assert.equal(operation.stage, "completed");
  assert.equal(operation.owner_id, null);
});

test("fork deletion removes fork-owned rows without deleting ancestor-owned resources", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-fork-resource-isolation-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const storagePath = "/sessions/family.sqlite";
  const ancestorRef = { backend: "sqlite", id: "ancestor", storagePath };
  const forkRef = { backend: "sqlite", id: "fork", storagePath };
  const ancestor = await store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "ancestor", storagePath, createdAt: "ancestor" });
  const fork = await store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "fork", storagePath, createdAt: "fork" });
  for (const [kind, owner, reference, port] of [["ancestor", ancestor, ancestorRef, 4330], ["fork", fork, forkRef, 4331]]) {
    await store.repositories.checkpoints.record(reference, { hash: `${kind}-hash`, anchorId: `${kind}-anchor`, sessionRef: reference, timestamp: `${kind}-checkpoint` });
    await store.repositories.routines.upsert({ id: `${kind}-routine`, ownerId: owner.id, name: `${kind}.sh`, script: `echo ${kind}`, now: `${kind}-routine` });
    await store.repositories.routines.createRun({ id: `${kind}-run`, routineId: `${kind}-routine`, mode: "run", startedAt: `${kind}-run` });
    await store.repositories.routines.appendLog(`${kind}-run`, "stdout", `${kind}-log`, `${kind}-log`);
    await store.repositories.hublots.create({ id: `${kind}-hublot`, ownerId: owner.id, port, workdir: `/${kind}`, serviceKind: "self_served", status: "open", desiredState: "open", createdAt: `${kind}-hublot` });
    await store.repositories.hublots.appendLifecycleEvent({ hublotId: `${kind}-hublot`, status: "open", desiredState: "open", createdAt: `${kind}-event` });
    await store.repositories.runners.create({ id: `${kind}-runner0`, ownerId: owner.id, dir: `/${kind}`, sessionBackend: "sqlite", sessionId: reference.id, sessionStoragePath: storagePath, desiredState: "stopped", lastStatus: "stopped", createdAt: `${kind}-runner` });
  }
  const ancestorSnapshot = {
    checkpoints: await store.repositories.checkpoints.listForSession(ancestorRef),
    routine: await store.repositories.routines.findByName("ancestor.sh"),
    run: await store.repositories.routines.findRun("ancestor-run"),
    logs: await store.repositories.routines.listLogs("ancestor-run"),
    hublot: await store.repositories.hublots.find("ancestor-hublot"),
    history: await store.repositories.hublots.listLifecycleEvents("ancestor-hublot"),
    runner: await store.repositories.runners.find("ancestor-runner0"),
  };
  const workflow = createSessionDeletionWorkflow({ appStore: store, ensureSessionOwner: () => fork, operationId: () => "delete-fork", now: () => "deleted" });
  await workflow({
    reference: forkRef,
    stopRunners: () => ["fork-runner0"], stopRoutines: () => ["fork.sh"],
    deleteAgentSession: () => ({ deleted: "fork" }),
    closeHublots: () => [4331], deleteRoutines: () => ["fork.sh"], removeRuntime() {}, broadcast() {},
  });

  assert.equal(await store.repositories.sessions.find({ backend: "sqlite", sessionId: "fork", storagePath }), null);
  assert.deepEqual(await store.repositories.checkpoints.listForSession(forkRef), []);
  assert.equal(await store.repositories.routines.findByName("fork.sh"), null);
  assert.equal(await store.repositories.hublots.find("fork-hublot"), null);
  assert.equal(await store.repositories.runners.find("fork-runner0"), null);
  assert.ok(await store.repositories.sessions.find({ backend: "sqlite", sessionId: "ancestor", storagePath }));
  assert.deepEqual({
    checkpoints: await store.repositories.checkpoints.listForSession(ancestorRef),
    routine: await store.repositories.routines.findByName("ancestor.sh"),
    run: await store.repositories.routines.findRun("ancestor-run"),
    logs: await store.repositories.routines.listLogs("ancestor-run"),
    hublot: await store.repositories.hublots.find("ancestor-hublot"),
    history: await store.repositories.hublots.listLifecycleEvents("ancestor-hublot"),
    runner: await store.repositories.runners.find("ancestor-runner0"),
  }, ancestorSnapshot);
});
