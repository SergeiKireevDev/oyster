import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-routine-reconcile-"));
  const path = join(root, "app.sqlite");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return path;
}

test("startup reconciliation marks unfinished routine runs interrupted exactly once", (t) => {
  const path = fixture(t);
  let store = openAppStore({ databasePath: path });
  const routines = store.repositories.routines;
  const definition = routines.upsert({ id: "routine-1", name: "build.sh", script: "#!/bin/sh\n", now: "created" });
  routines.createRun({ id: "unfinished", routineId: definition.id, mode: "run", status: "running", startedAt: "started" });
  routines.updateProgress("unfinished", 42, "building");
  routines.appendLog("unfinished", "stdout", "durable output", "logged");
  routines.createRun({ id: "complete", routineId: definition.id, mode: "teardown", status: "teardown", startedAt: "earlier" });
  routines.finishRun("complete", { status: "idle", result: "removed", finishedAt: "finished", exitCode: 0 });
  store.close();

  store = openAppStore({ databasePath: path });
  assert.equal(store.reconcileInterruptedRoutineRuns("restarted"), 1);
  assert.equal(store.reconcileInterruptedRoutineRuns("later"), 0);

  const interrupted = store.repositories.routines.findRun("unfinished");
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.finished_at, "restarted");
  assert.equal(interrupted.error, "server restarted before the routine process finished");
  assert.equal(interrupted.progress, 42);
  assert.equal(interrupted.message, "building");
  assert.deepEqual(store.repositories.routines.listLogs("unfinished").map((line) => line.text), ["durable output"]);

  const complete = store.repositories.routines.findRun("complete");
  assert.equal(complete.status, "idle");
  assert.equal(complete.finished_at, "finished");
  store.close();
});
