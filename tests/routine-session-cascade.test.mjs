import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { createRoutine, deleteSessionRoutines, startRoutine, stopRoutine, stopSessionRoutines } from "../server/routines.mjs";

const SCRIPT = "#!/bin/sh\necho live-output\nsleep 30\n";

function owner(store, sessionId) {
  return store.repositories.sessions.upsert({ backend: "sqlite", sessionId, storagePath: "/agent.sqlite", createdAt: "created" });
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-routine-cascade-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const waiters = [];
  const state = {
    appStore: store,
    currentDir: root,
    routineRuntimeDir: join(root, "runtime"),
    serverEvent(event) {
      for (const waiter of [...waiters]) {
        if (!waiter.predicate(event)) continue;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    },
  };
  const waitForEvent = (predicate) => new Promise((resolve) => waiters.push({ predicate, resolve }));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, state, waitForEvent };
}

test("session deletion removes owned routine definitions, runs, logs, and live handles only", async (t) => {
  const { root, store, state, waitForEvent } = fixture(t);
  const ownerA = owner(store, "session-a");
  const ownerB = owner(store, "session-b");
  createRoutine(state, { name: "owned.sh", script: SCRIPT, sessionId: "session-a", ownerId: ownerA.id, cwd: root });
  createRoutine(state, { name: "other.sh", script: SCRIPT, sessionId: "session-b", ownerId: ownerB.id, cwd: root });
  createRoutine(state, { name: "global.sh", script: SCRIPT });

  const outputA = waitForEvent((event) => event.reason === "output" && event.routine.name === "owned.sh");
  startRoutine(state, "owned.sh", { sessionId: "session-a", ownerId: ownerA.id, cwd: root });
  await outputA;
  const ownedDefinition = store.repositories.routines.findByName("owned.sh");
  const ownedRun = store.repositories.routines.findLatestRun(ownedDefinition.id);
  const ownedProcess = state.routineRuntime.get(ownedDefinition.id).proc;

  const outputB = waitForEvent((event) => event.reason === "output" && event.routine.name === "other.sh");
  startRoutine(state, "other.sh", { sessionId: "session-b", ownerId: ownerB.id, cwd: root });
  await outputB;
  const otherDefinition = store.repositories.routines.findByName("other.sh");
  const otherRun = store.repositories.routines.findLatestRun(otherDefinition.id);
  const otherRuntime = state.routineRuntime.get(otherDefinition.id);

  assert.deepEqual(stopSessionRoutines(state, "session-a"), ["owned.sh"]);
  assert.deepEqual(deleteSessionRoutines(state, "session-a"), ["owned.sh"]);
  store.repositories.sessions.delete(ownerA.id);

  assert.equal(store.repositories.routines.findByName("owned.sh"), null);
  assert.equal(store.repositories.routines.findRun(ownedRun.id), null);
  assert.deepEqual(store.repositories.routines.listLogs(ownedRun.id), []);
  assert.equal(state.routineRuntime.has(ownedDefinition.id), false);
  for (let attempt = 0; attempt < 20 && ownedProcess.exitCode === null && ownedProcess.signalCode === null; attempt++) await delay(10);
  assert.equal(ownedProcess.signalCode, "SIGTERM");

  assert.equal(store.repositories.routines.findByName("other.sh").id, otherDefinition.id);
  assert.equal(store.repositories.routines.findRun(otherRun.id).status, "running");
  assert.deepEqual(store.repositories.routines.listLogs(otherRun.id).map((line) => line.text), ["live-output"]);
  assert.equal(state.routineRuntime.get(otherDefinition.id), otherRuntime);
  assert.ok(store.repositories.routines.findByName("global.sh"));

  const otherExit = once(otherRuntime.proc, "exit");
  stopRoutine(state, "other.sh");
  await otherExit;
});
