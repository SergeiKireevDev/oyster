import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { createAppSettings } from "../server/persistence/appSettings.mjs";
import { createPiProcessLauncher } from "../server/pi-processes.mjs";
import { createRunnerManager, RUNNER_EPHEMERAL_FIELDS, RUNNER_MANAGER_EPHEMERAL_FIELDS } from "../server/runners.mjs";
import { createSessionReferenceCodec } from "../server/session-references.mjs";

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
  state.appSettings = createAppSettings({ repository: store.repositories.settings, startupWorkdir: root, now: () => "setting-time" });
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
  const streamReader = runner.stdoutReader;
  const reloadedManager = createRunnerManager(state, { appStore: store, ensureSessionOwner: () => owner, now: () => "reload" });
  assert.equal(state.runners.get(runner.id).proc, processes[0], "hot reload retains the live process handle");
  assert.equal(state.runners.get(runner.id).stdoutReader, streamReader, "hot reload retains the stream reader");
  assert.equal(store.repositories.runners.find(runner.id).last_status, "running", "hot reload must not interrupt a retained process");
  assert.equal(reloadedManager.runnerFromReq(new URL(`http://localhost/?runner=${runner.id}`)), runner);
  assert.equal("buffer" in runner, false, "durable replay must not retain a second in-memory copy");
  assert.deepEqual(manager.replayRunnerEvents(runner), store.repositories.runnerEvents.list(runner.id).map((event) => event.payload));

  manager.defaultRunner();
  assert.equal(store.repositories.runners.find(runner.id).is_default, 1);
  assert.equal(state.appSettings.hydrate().defaultRunnerId, runner.id);
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

test("runner replay and selected workdir survive restart without eager process spawning", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-runner-restore-"));
  const databasePath = join(root, "app.sqlite");
  let store = openAppStore({ databasePath });
  const sqlitePath = join(root, "agent.sqlite");
  const owner = store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "restored-session", storagePath: sqlitePath, createdAt: "owner" });
  const runnerId = "r-restored000";
  store.repositories.runners.create({
    id: runnerId, ownerId: owner.id, dir: "/persisted/workspace",
    sessionBackend: "sqlite", sessionId: "restored-session", sessionStoragePath: sqlitePath,
    sessionName: "Persisted name", isDefault: true, desiredState: "running", lastStatus: "running",
    startCount: 4, createdAt: "created", lastStartedAt: "previous-start",
  });
  store.repositories.runnerEvents.append({ runnerId, sseId: "persisted-event-1", payload: '{"type":"persisted","part":1}', createdAt: "event-1" });
  store.repositories.runnerEvents.append({ runnerId, sseId: "persisted-event-2", payload: '{"type":"persisted","part":2}', createdAt: "event-2" });
  store.repositories.runners.create({
    id: "r-stopped0000", dir: "/stopped", desiredState: "stopped", lastStatus: "stopped", createdAt: "stopped-created", lastStoppedAt: "already-stopped",
  });
  createAppSettings({ repository: store.repositories.settings, startupWorkdir: "/startup", now: () => "selected" })
    .setCurrentWorkdir("/persisted/workspace");
  store.close();
  store = openAppStore({ databasePath });
  const sessionReferences = createSessionReferenceCodec({ agentDir: root, jsonlRoot: join(root, "sessions"), sqlitePath });
  const hydratedSettings = createAppSettings({ repository: store.repositories.settings, startupWorkdir: "/other" }).hydrate();
  let spawnCount = 0;
  const state = {
    appStore: store,
    config: { PI_BIN: "/pi", PI_EXTRA_ARGS: [], PERSISTENT_STORE: "sqlite", SQLITE_PATH: sqlitePath },
    currentDir: hydratedSettings.currentWorkdir,
    sseClients: new Set(),
    sessionReferences,
    serverEvent() {},
  };
  state.piProcesses = createPiProcessLauncher({ config: state.config, spawnImpl() { spawnCount++; return fakeProcess(); } });
  const manager = createRunnerManager(state, { appStore: store, now: () => "now" });
  t.after(() => {
    clearInterval(state.runnerWatchdogTimer);
    clearInterval(state.runnerReaperTimer);
    manager.stopPi();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  const restored = state.runners.get(runnerId);
  assert.equal(state.currentDir, "/persisted/workspace", "persisted selected workdir overrides the new startup default");
  assert.equal(restored.dir, "/persisted/workspace");
  assert.equal(restored.sessionId, "restored-session");
  assert.equal(restored.sessionName, "Persisted name");
  assert.equal(restored.startCount, 4);
  assert.equal(restored.proc, null);
  for (const field of RUNNER_EPHEMERAL_FIELDS) assert.equal(Object.hasOwn(restored, field), true, `missing runtime field ${field}`);
  const persistedFields = new Set(Object.keys(store.repositories.runners.find(runnerId)));
  for (const field of RUNNER_EPHEMERAL_FIELDS) assert.equal(persistedFields.has(field), false, `${field} must not be durable`);
  for (const field of RUNNER_MANAGER_EPHEMERAL_FIELDS) {
    assert.ok(state[field], `stable runtime state must own ${field}`);
    assert.equal(persistedFields.has(field), false, `${field} must not be durable`);
  }
  assert.equal(state.defaultRunnerId, runnerId);
  assert.equal(store.repositories.runners.find(runnerId).last_status, "interrupted");
  assert.equal(store.repositories.runners.find(runnerId).desired_state, "stopped");
  assert.equal(store.repositories.runners.find(runnerId).last_stopped_at, "now");
  assert.equal(store.repositories.runners.find("r-stopped0000").last_status, "stopped");
  assert.equal(store.repositories.runners.find("r-stopped0000").last_stopped_at, "already-stopped");
  assert.deepEqual(manager.replayRunnerEvents(restored), [
    '{"type":"persisted","part":1}', '{"type":"persisted","part":2}',
  ]);
  assert.deepEqual(store.repositories.runnerEvents.list(runnerId).map(({ sequence, sse_id }) => [sequence, sse_id]), [
    [1, "persisted-event-1"], [2, "persisted-event-2"],
  ]);
  manager.startPi();
  assert.equal(spawnCount, 0, "server startup must not eagerly spawn restored runners");
  assert.equal(manager.runnerFromReq(new URL(`http://localhost/?runner=${runnerId}`)), restored);
  assert.equal(spawnCount, 0, "descriptor lookup alone remains lazy");
  manager.sendToRunner(restored, { type: "get_state" });
  assert.equal(spawnCount, 1, "the selected runner starts on first command demand");
  assert.ok(restored.proc);
  assert.ok(restored.stdoutReader);
  assert.equal(restored.startCount, 5);
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

test("backend rollback ignores an incompatible persisted default runner without deleting it", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-runner-backend-toggle-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const sqlitePath = join(root, "sessions.sqlite");
  const sessionReferences = createSessionReferenceCodec({ agentDir: root, jsonlRoot: join(root, "sessions"), sqlitePath });
  const owner = store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "sqlite-session", storagePath: sqlitePath, createdAt: "owner" });
  store.repositories.runners.create({
    id: "r-12345678-1234-4123-8123-123456789abc", ownerId: owner.id, dir: "/workspace", sessionBackend: "sqlite", sessionId: "sqlite-session",
    sessionStoragePath: sqlitePath, isDefault: true, desiredState: "stopped", lastStatus: "stopped", createdAt: "created",
  });
  const appSettings = createAppSettings({ repository: store.repositories.settings, startupWorkdir: "/workspace", now: () => "setting" });
  appSettings.setDefaultRunnerId("r-12345678-1234-4123-8123-123456789abc");
  let spawnCount = 0;
  const state = {
    appStore: store, appSettings,
    config: { PI_BIN: "/pi", PI_EXTRA_ARGS: [], PERSISTENT_STORE: "jsonl" },
    currentDir: "/workspace", sseClients: new Set(), sessionReferences, serverEvent() {},
  };
  state.piProcesses = createPiProcessLauncher({ config: state.config, spawnImpl() { spawnCount++; return fakeProcess(); } });
  const manager = createRunnerManager(state, {
    appStore: store, createRunnerId: () => "87654321-4321-4321-8321-cba987654321", now: () => "now",
  });
  t.after(() => {
    clearInterval(state.runnerWatchdogTimer);
    clearInterval(state.runnerReaperTimer);
    manager.stopPi();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  assert.equal(state.defaultRunnerId ?? null, null);
  assert.equal(spawnCount, 0);
  const selected = manager.runnerFromReq(new URL("http://localhost/events?runner=r-12345678-1234-4123-8123-123456789abc"));
  assert.equal(selected.sessionRef, null);
  assert.notEqual(selected.id, "r-12345678-1234-4123-8123-123456789abc");
  assert.equal(spawnCount, 1);
  assert.ok(store.repositories.runners.find("r-12345678-1234-4123-8123-123456789abc"), "dormant SQLite descriptor survives a JSONL rollback toggle");
  assert.equal(store.repositories.runners.find(selected.id).session_backend, null);
});
