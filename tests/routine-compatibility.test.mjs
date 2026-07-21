import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { createRoutine, deleteRoutine, listRoutines, releaseRoutine, startRoutine, teardownRoutine } from "../routines.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-routine-compat-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const events = [];
  let waiter = null;
  const state = {
    appStore: store,
    currentDir: root,
    routineRuntimeDir: join(root, "runtime"),
    serverEvent(event) {
      events.push(event);
      if (waiter && waiter.reason === event.reason) { const resolve = waiter.resolve; waiter = null; resolve(event); }
    },
  };
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const waitFor = (reason) => new Promise((resolve) => { waiter = { reason, resolve }; });
  return { root, store, state, events, waitFor };
}

function owner(store, sessionId) {
  return store.repositories.sessions.upsert({ backend: "sqlite", sessionId, storagePath: "/agent.sqlite", createdAt: "created" });
}

const SCRIPT = `#!/bin/sh
case "$1" in
  run)
    echo "::progress 40 working"
    echo "ordinary output"
    ;;
  teardown)
    echo "cleanup output"
    ;;
esac
`;

test("SQLite-backed routines preserve payloads, SSE lifecycle, and session binding rules", async (t) => {
  const { root, store, state, events, waitFor } = fixture(t);
  const ownerA = owner(store, "session-a");
  const ownerB = owner(store, "session-b");

  const created = createRoutine(state, { name: "job.sh", script: SCRIPT, sessionId: "session-a", ownerId: ownerA.id, cwd: root });
  assert.deepEqual(Object.keys(created).sort(), ["alive", "cwd", "exitCode", "finishedAt", "log", "message", "name", "path", "progress", "sessionId", "startedAt", "status"]);
  assert.equal(created.sessionId, "session-a");
  assert.equal(created.status, "idle");
  assert.equal(created.alive, false);
  assert.equal(events.at(-1).reason, "created");
  assert.equal(events.at(-1).type, "routine_update");

  assert.throws(
    () => startRoutine(state, "job.sh", { sessionId: "session-b", ownerId: ownerB.id, cwd: root }),
    /bound to another session/,
  );
  const updated = createRoutine(state, { name: "job.sh", script: SCRIPT, cwd: root });
  assert.equal(updated.sessionId, "session-a", "an ownerless update must not steal a bound definition");

  const released = releaseRoutine(state, "job.sh");
  assert.equal(released.sessionId, null);
  assert.equal(events.at(-1).reason, "released");

  const finished = waitFor("finished");
  const started = startRoutine(state, "job.sh", { sessionId: "session-b", ownerId: ownerB.id, cwd: root });
  assert.equal(started.status, "running");
  assert.equal(started.alive, true);
  await finished;

  const afterRun = listRoutines(state)[0];
  assert.equal(afterRun.sessionId, "session-b");
  assert.equal(afterRun.status, "done");
  assert.equal(afterRun.progress, 100);
  assert.equal(afterRun.message, "working");
  assert.deepEqual(afterRun.log, ["ordinary output"]);
  assert.deepEqual(events.filter((event) => ["started", "progress", "output", "finished"].includes(event.reason)).map((event) => event.reason), ["started", "progress", "output", "finished"]);
  assert.ok(events.filter((event) => event.type === "routine_update").every((event) => !Object.hasOwn(event.routine, "proc") && typeof event.routine.alive === "boolean"));

  const tornDown = waitFor("teardown_finished");
  const tearingDown = teardownRoutine(state, "job.sh");
  assert.equal(tearingDown.status, "teardown");
  assert.equal(tearingDown.alive, true);
  await tornDown;
  const afterTeardown = listRoutines(state)[0];
  assert.equal(afterTeardown.status, "idle");
  assert.equal(afterTeardown.message, "byproducts removed");
  assert.deepEqual(afterTeardown.log, ["cleanup output"]);

  const deleted = deleteRoutine(state, "job.sh");
  assert.equal(deleted.sessionId, null);
  assert.equal(deleted.cwd, null);
  assert.equal(events.at(-1).reason, "deleted");
  assert.deepEqual(listRoutines(state), []);
});
