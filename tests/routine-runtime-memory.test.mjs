import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { createRoutine, startRoutine, stopRoutine } from "../server/routines.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-routine-runtime-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}

test("routine memory contains only a process handle and stream readers", async (t) => {
  const { root, store } = fixture(t);
  const state = { appStore: store, currentDir: root, routineRuntimeDir: join(root, "runtime"), serverEvent() {} };
  createRoutine(state, { name: "sleep.sh", script: "#!/bin/sh\nsleep 30\n" });
  assert.equal(state.routineRuntime.size, 0);
  assert.equal(state.routines, undefined);

  startRoutine(state, "sleep.sh");
  const runtime = [...state.routineRuntime.values()][0];
  assert.deepEqual(Object.keys(runtime).sort(), ["proc", "readers"]);
  assert.equal(typeof runtime.proc.pid, "number");
  assert.equal(runtime.readers.size, 2);
  assert.equal(state.routines, undefined);

  const exited = once(runtime.proc, "exit");
  stopRoutine(state, "sleep.sh");
  await exited;
  assert.equal(state.routineRuntime.size, 0);

  const persisted = store.repositories.routines.findLatestRun(store.repositories.routines.findByName("sleep.sh").id);
  assert.equal(persisted.status, "stopped");
  assert.ok(persisted.finished_at);
});
