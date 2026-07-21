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

test("routine definitions, bindings, progress, logs, results, and interruption survive restart", (t) => {
  const path = fixture(t);
  let store = openAppStore({ databasePath: path });
  const routines = store.repositories.routines;
  const owner = store.repositories.sessions.upsert({
    backend: "jsonl", sessionId: "session-a", storagePath: "/agent/sessions/session-a.jsonl", createdAt: "created",
  });
  const definition = routines.upsert({
    id: "routine-1", ownerId: owner.id, name: "build.sh", script: "#!/bin/sh\necho build\n", cwd: "/workspace", now: "created",
  });
  routines.createRun({ id: "unfinished", routineId: definition.id, mode: "run", status: "running", startedAt: "started" });
  routines.updateProgress("unfinished", 42, "building");
  routines.appendLog("unfinished", "stdout", "durable output", "logged");
  routines.createRun({ id: "complete", routineId: definition.id, mode: "teardown", status: "teardown", startedAt: "earlier" });
  routines.appendLog("complete", "stderr", "teardown output", "complete-logged");
  routines.finishRun("complete", { status: "idle", result: "removed", finishedAt: "finished", exitCode: 0 });
  store.close();

  store = openAppStore({ databasePath: path });
  const restoredDefinition = store.repositories.routines.findByName("build.sh");
  assert.deepEqual({
    id: restoredDefinition.id,
    sessionId: restoredDefinition.session_id,
    script: restoredDefinition.script,
    cwd: restoredDefinition.cwd,
    revision: restoredDefinition.revision,
  }, {
    id: "routine-1",
    sessionId: "session-a",
    script: "#!/bin/sh\necho build\n",
    cwd: "/workspace",
    revision: 1,
  });
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
  assert.equal(complete.result, "removed");
  assert.equal(complete.finished_at, "finished");
  assert.deepEqual(store.repositories.routines.listLogs("complete").map((line) => [line.stream, line.text]), [["stderr", "teardown output"]]);
  store.close();
});
