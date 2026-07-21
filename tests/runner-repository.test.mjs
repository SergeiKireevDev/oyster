import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { createPiProcessLauncher } from "../pi-processes.mjs";
import { createRunnerManager } from "../runners.mjs";
import { createSessionReferenceCodec } from "../session-references.mjs";

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.exitCode = null;
  proc.killed = false;
  proc.kill = (signal) => { proc.killed = true; proc.signal = signal; };
  return proc;
}

test("runner repository persists descriptors, default selection, lifecycle, and ownership", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-runner-repository-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const sqlitePath = join(root, "agent.sqlite");
  const sessionReferences = createSessionReferenceCodec({ agentDir: root, jsonlRoot: join(root, "sessions"), sqlitePath });
  const owner = store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "session-1", storagePath: sqlitePath, createdAt: "owner-created" });
  const state = {
    appStore: store,
    config: { PI_BIN: "/pi", PI_EXTRA_ARGS: [], PERSISTENT_STORE: "sqlite", SQLITE_PATH: sqlitePath },
    currentDir: root,
    runners: new Map(),
    sseClients: new Set(),
    sessionReferences,
    serverEvent() {},
  };
  const processes = [];
  state.piProcesses = createPiProcessLauncher({
    config: state.config,
    spawnImpl() { const proc = fakeProcess(); processes.push(proc); return proc; },
  });
  const manager = createRunnerManager(state, {
    appStore: store,
    ensureSessionOwner: () => owner,
    createRunnerId: () => "12345678-1234-4123-8123-123456789abc",
    now: () => "time",
  });
  t.after(() => {
    clearInterval(state.runnerWatchdogTimer);
    clearInterval(state.runnerReaperTimer);
    manager.stopPi();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  const reference = { backend: "sqlite", id: "session-1", storagePath: sqlitePath };
  const runner = manager.spawnRunner({ dir: "/workspace", sessionRef: reference });
  let persisted = store.repositories.runners.find(runner.id);
  assert.equal(persisted.owner_id, owner.id);
  assert.equal(persisted.dir, "/workspace");
  assert.equal(persisted.session_backend, "sqlite");
  assert.equal(persisted.session_id, "session-1");
  assert.equal(persisted.session_storage_path, sqlitePath);
  assert.equal(persisted.desired_state, "running");
  assert.equal(persisted.last_status, "running");
  assert.equal(persisted.start_count, 1);
  assert.equal(persisted.created_at, "time");
  assert.equal(persisted.last_started_at, "time");
  assert.equal("buffer" in runner, false, "durable replay must not retain a second in-memory copy");
  assert.deepEqual(manager.replayRunnerEvents(runner), store.repositories.runnerEvents.list(runner.id).map((event) => event.payload));

  manager.defaultRunner();
  assert.equal(store.repositories.runners.find(runner.id).is_default, 1);
  processes[0].stdout.write(`${JSON.stringify({ type: "response", id: "state-response", success: true, command: "get_state", data: { sessionId: "session-1", sessionName: "Named runner" } })}\n`);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(store.repositories.runners.find(runner.id).session_name, "Named runner");

  manager.stopRunner(runner);
  persisted = store.repositories.runners.find(runner.id);
  assert.equal(persisted.desired_state, "stopped");
  assert.equal(persisted.last_status, "stopped");
  assert.equal(persisted.last_stopped_at, "time");

  store.repositories.sessions.delete(owner.id);
  assert.equal(store.repositories.runners.find(runner.id), null, "session ownership cascades runner descriptors");
});

test("runner replay events persist exact payloads and enforce their configured cap", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-runner-events-"));
  const databasePath = join(root, "app.sqlite");
  let store = openAppStore({ databasePath });
  t.after(() => { try { store.close(); } catch {} rmSync(root, { recursive: true, force: true }); });
  store.repositories.runners.create({ id: "r-events000", dir: "/workspace", desiredState: "stopped", lastStatus: "stopped", createdAt: "created" });
  for (let index = 1; index <= 5; index++) {
    store.repositories.runnerEvents.append({
      runnerId: "r-events000", sseId: `event-${index}`, payload: JSON.stringify({ index }), createdAt: `time-${index}`, maxEntries: 3,
    });
  }
  assert.deepEqual(store.repositories.runnerEvents.list("r-events000").map((event) => [event.sequence, event.sse_id, event.payload]), [
    [3, "event-3", '{"index":3}'], [4, "event-4", '{"index":4}'], [5, "event-5", '{"index":5}'],
  ]);
  store.repositories.runnerEvents.append({ runnerId: "r-events000", sseId: "event-5", payload: "duplicate", createdAt: "later", maxEntries: 3 });
  assert.equal(store.repositories.runnerEvents.list("r-events000").length, 3, "replayed SSE IDs are idempotent");
  store.close();
  store = openAppStore({ databasePath });
  assert.deepEqual(store.repositories.runnerEvents.list("r-events000").map((event) => event.sequence), [3, 4, 5]);
  store.repositories.runners.delete("r-events000");
  assert.deepEqual(store.repositories.runnerEvents.list("r-events000"), []);
});

test("runner repository enforces one selected default", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-runner-default-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const create = (id) => store.repositories.runners.create({ id, dir: "/workspace", desiredState: "stopped", lastStatus: "stopped", createdAt: id });
  create("r-aaaaaaaa");
  create("r-bbbbbbbb");
  store.repositories.runners.setDefault("r-aaaaaaaa");
  store.repositories.runners.setDefault("r-bbbbbbbb");
  assert.equal(store.repositories.runners.find("r-aaaaaaaa").is_default, 0);
  assert.equal(store.repositories.runners.find("r-bbbbbbbb").is_default, 1);
  assert.throws(() => store.repositories.runners.update("r-aaaaaaaa", { is_default: 1 }), /unique constraint/i);
});
