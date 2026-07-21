import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-routine-repository-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const owner = store.repositories.sessions.upsert({
    backend: "sqlite", sessionId: "session-a", storagePath: "/agent/sessions.sqlite", createdAt: "created",
  });
  return { store, owner };
}

test("routine repository persists definitions, ownership, scripts, bindings, and revisions", (t) => {
  const { store, owner } = setup(t);
  const routines = store.repositories.routines;
  const created = routines.upsert({
    id: "routine-1", ownerId: owner.id, name: "build.sh", script: "#!/bin/sh\necho one", cwd: "/work", now: "time-1",
  });
  assert.deepEqual(created, {
    id: "routine-1", owner_id: owner.id, session_id: "session-a", name: "build.sh", script: "#!/bin/sh\necho one",
    revision: 1, cwd: "/work", created_at: "time-1", updated_at: "time-1",
  });

  const updated = routines.upsert({
    id: "ignored-on-update", ownerId: owner.id, name: "build.sh", script: "#!/bin/sh\necho two", cwd: "/work/two", now: "time-2",
  });
  assert.equal(updated.id, "routine-1");
  assert.equal(updated.revision, 2);
  assert.equal(updated.script, "#!/bin/sh\necho two");
  assert.equal(routines.release(updated.id, "time-3"), 1);
  assert.equal(routines.findByName("build.sh").owner_id, null);
  assert.equal(routines.bind(updated.id, owner.id, "/rebound", "time-4"), 1);
  assert.equal(routines.findByName("build.sh").cwd, "/rebound");
});

test("routine repository persists run progress, results, and bounded ordered logs", (t) => {
  const { store, owner } = setup(t);
  const routines = store.repositories.routines;
  routines.upsert({ id: "routine-1", ownerId: owner.id, name: "build.sh", script: "#!/bin/sh\n", cwd: "/work", now: "created" });
  assert.deepEqual(routines.createRun({ id: "run-1", routineId: "routine-1", mode: "run", startedAt: "started" }), {
    id: "run-1", routine_id: "routine-1", mode: "run", status: "running", progress: null,
    message: null, result: null, started_at: "started", finished_at: null, exit_code: null, error: null,
  });
  routines.updateProgress("run-1", 42, "building");
  for (let index = 1; index <= 85; index++) {
    routines.appendLog("run-1", index % 2 ? "stdout" : "stderr", `line-${index}`, `time-${index}`, 80);
  }
  routines.finishRun("run-1", { status: "completed", result: '{"artifact":"dist"}', finishedAt: "finished", exitCode: 0 });

  const run = routines.findRun("run-1");
  assert.equal(run.progress, 42);
  assert.equal(run.message, "building");
  assert.equal(run.status, "completed");
  assert.equal(run.result, '{"artifact":"dist"}');
  const logs = routines.listLogs("run-1");
  assert.equal(logs.length, 80);
  assert.equal(logs[0].sequence, 6);
  assert.equal(logs.at(-1).text, "line-85");
});

test("routine ownership cascades definitions, runs, and logs while global routines survive", (t) => {
  const { store, owner } = setup(t);
  const routines = store.repositories.routines;
  routines.upsert({ id: "owned", ownerId: owner.id, name: "owned.sh", script: "owned", now: "created" });
  routines.upsert({ id: "global", name: "global.sh", script: "global", now: "created" });
  routines.createRun({ id: "owned-run", routineId: "owned", mode: "teardown", startedAt: "started" });
  routines.appendLog("owned-run", "stdout", "cleanup", "logged");

  store.transaction((repositories) => repositories.sessions.delete(owner.id));

  assert.equal(routines.findByName("owned.sh"), null);
  assert.equal(routines.findRun("owned-run"), null);
  assert.deepEqual(routines.listLogs("owned-run"), []);
  assert.equal(routines.findByName("global.sh").id, "global");
});
