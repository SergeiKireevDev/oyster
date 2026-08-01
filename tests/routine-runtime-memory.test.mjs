import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { createRoutine, startRoutine, stopAllRoutines, stopRoutine, teardownRoutine } from "../server/routines.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-routine-runtime-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}

test("routine memory contains only live process resources", async (t) => {
  const { root, store } = fixture(t);
  const state = { appStore: store, currentDir: root, routineRuntimeDir: join(root, "runtime"), serverEvent() {} };
  createRoutine(state, { name: "sleep.sh", script: "#!/bin/sh\nsleep 30\n" });
  assert.equal(state.routineRuntime.size, 0);
  assert.equal(state.routines, undefined);

  startRoutine(state, "sleep.sh");
  const runtime = [...state.routineRuntime.values()][0];
  assert.deepEqual(Object.keys(runtime).sort(), ["proc", "readers", "stopTimer"]);
  assert.equal(typeof runtime.proc.pid, "number");
  assert.equal(runtime.readers.size, 2);
  assert.equal(runtime.stopTimer, null);
  assert.equal(state.routines, undefined);

  const closed = once(runtime.proc, "close");
  stopRoutine(state, "sleep.sh");
  assert.ok(runtime.stopTimer, "stopping should schedule forced termination");
  await closed;
  assert.equal(runtime.stopTimer, null, "normal process closure should cancel forced termination");
  assert.equal(state.routineRuntime.size, 0);

  const persisted = store.repositories.routines.findLatestRun(store.repositories.routines.findByName("sleep.sh").id);
  assert.equal(persisted.status, "stopped");
  assert.ok(persisted.finished_at);
});

test("routine inputs are validated at the manager boundary", (t) => {
  const { root, store } = fixture(t);
  const state = { appStore: store, currentDir: root, serverEvent() {} };
  assert.throws(() => createRoutine(state, { name: "job.sh" }), /script must be a string/);
  assert.throws(() => createRoutine(state, { name: "job.sh", script: "", cwd: 42 }), /cwd must be a string or null/);
  assert.deepEqual(store.repositories.routines.list(), []);
});

test("stopping teardown records a stopped result", async (t) => {
  const { root, store } = fixture(t);
  const state = { appStore: store, currentDir: root, routineRuntimeDir: join(root, "runtime"), serverEvent() {} };
  createRoutine(state, {
    name: "cleanup.sh",
    script: "#!/bin/sh\ncase \"$1\" in teardown) sleep 30 ;; esac\n",
  });
  teardownRoutine(state, "cleanup.sh");
  const runtime = [...state.routineRuntime.values()][0];
  const closed = once(runtime.proc, "close");
  stopRoutine(state, "cleanup.sh");
  await closed;

  const definition = store.repositories.routines.findByName("cleanup.sh");
  assert.equal(store.repositories.routines.findLatestRun(definition.id).status, "stopped");
});

test("shutdown detaches runtime state before killing children", async (t) => {
  const { root, store } = fixture(t);
  const state = { appStore: store, currentDir: root, routineRuntimeDir: join(root, "runtime"), serverEvent() {} };
  createRoutine(state, { name: "shutdown.sh", script: "#!/bin/sh\nsleep 30\n" });
  startRoutine(state, "shutdown.sh");
  const runtime = [...state.routineRuntime.values()][0];
  const closed = once(runtime.proc, "close");

  stopAllRoutines(state);
  assert.equal(state.routineRuntime.size, 0);
  assert.equal(runtime.readers.size, 2);
  await closed;
  assert.equal(store.repositories.routines.findLatestRun(store.repositories.routines.findByName("shutdown.sh").id).status, "running");
});
