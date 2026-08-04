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
const TERM_RESISTANT_SCRIPT = "#!/bin/sh\ntrap '' TERM\necho live-output\nwhile :; do sleep 1; done\n";

async function owner(store, sessionId) {
  return await store.repositories.sessions.upsert({ backend: "sqlite", sessionId, storagePath: "/agent.sqlite", createdAt: "created" });
}

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-routine-cascade-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
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
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, state, waitForEvent };
}

test("session deletion removes owned routine definitions, runs, logs, and live handles only", async (t) => {
  const { root, store, state, waitForEvent } = await fixture(t);
  const ownerA = await owner(store, "session-a");
  const ownerB = await owner(store, "session-b");
  await createRoutine(state, { name: "owned.sh", script: TERM_RESISTANT_SCRIPT, sessionId: "session-a", ownerId: ownerA.id, cwd: root });
  await createRoutine(state, { name: "other.sh", script: SCRIPT, sessionId: "session-b", ownerId: ownerB.id, cwd: root });
  await createRoutine(state, { name: "global.sh", script: SCRIPT });

  const outputA = waitForEvent((event) => event.reason === "output" && event.routine.name === "owned.sh");
  await startRoutine(state, "owned.sh", { sessionId: "session-a", ownerId: ownerA.id, cwd: root });
  await outputA;
  const ownedDefinition = await store.repositories.routines.findByName("owned.sh");
  const ownedRun = await store.repositories.routines.findLatestRun(ownedDefinition.id);
  const ownedProcess = state.routineRuntime.get(ownedDefinition.id).proc;

  const outputB = waitForEvent((event) => event.reason === "output" && event.routine.name === "other.sh");
  await startRoutine(state, "other.sh", { sessionId: "session-b", ownerId: ownerB.id, cwd: root });
  await outputB;
  const otherDefinition = await store.repositories.routines.findByName("other.sh");
  const otherRun = await store.repositories.routines.findLatestRun(otherDefinition.id);
  const otherRuntime = state.routineRuntime.get(otherDefinition.id);

  assert.deepEqual(await stopSessionRoutines(state, "session-a"), ["owned.sh"]);
  assert.deepEqual(await deleteSessionRoutines(state, "session-a"), ["owned.sh"]);
  await store.repositories.sessions.delete(ownerA.id);

  assert.equal(await store.repositories.routines.findByName("owned.sh"), null);
  assert.equal(await store.repositories.routines.findRun(ownedRun.id), null);
  assert.deepEqual(await store.repositories.routines.listLogs(ownedRun.id), []);
  assert.equal(state.routineRuntime.has(ownedDefinition.id), false);
  for (let attempt = 0; attempt < 50 && ownedProcess.exitCode === null && ownedProcess.signalCode === null; attempt++) await delay(10);
  assert.equal(ownedProcess.signalCode, "SIGKILL", "session deletion must force-kill routines that ignore SIGTERM");

  assert.equal((await store.repositories.routines.findByName("other.sh")).id, otherDefinition.id);
  assert.equal((await store.repositories.routines.findRun(otherRun.id)).status, "running");
  assert.deepEqual((await store.repositories.routines.listLogs(otherRun.id)).map((line) => line.text), ["live-output"]);
  assert.equal(state.routineRuntime.get(otherDefinition.id), otherRuntime);
  assert.ok(await store.repositories.routines.findByName("global.sh"));

  const otherClose = once(otherRuntime.proc, "close");
  await stopRoutine(state, "other.sh");
  await otherClose;
  await otherRuntime.completion;
});
