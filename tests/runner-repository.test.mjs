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
  const root = mkdtempSync(join(tmpdir(), "oyster-runner-repository-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  const sqlitePath = join(root, "agent.sqlite");
  const sessionReferences = createSessionReferenceCodec({ agentDir: root, jsonlRoot: join(root, "sessions"), sqlitePath });
  const owner = await store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "session-1", storagePath: sqlitePath, createdAt: "owner-created" });
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
  const manager = await createRunnerManager(state, {
    appStore: store,
    ensureSessionOwner: () => owner,
    createRunnerId: () => "12345678-1234-4123-8123-123456789abc",
    now: () => "time",
  });
  t.after(async () => {
    clearInterval(state.runnerWatchdogTimer);
    clearInterval(state.runnerReaperTimer);
    await manager.stopPi();
    await store.close();
    rmSync(root, { recursive: true, force: true });
  });

  const reference = { backend: "sqlite", id: "session-1", storagePath: sqlitePath };
  const runner = await manager.spawnRunner({ dir: "/workspace", sessionRef: reference });
  let persisted = await store.repositories.runners.find(runner.id);
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
  const reloadedManager = await createRunnerManager(state, { appStore: store, ensureSessionOwner: () => owner, now: () => "reload" });
  assert.equal(state.runners.get(runner.id).proc, processes[0], "hot reload retains the live process handle");
  assert.equal(state.runners.get(runner.id).stdoutReader, streamReader, "hot reload retains the stream reader");
  assert.equal((await store.repositories.runners.find(runner.id)).last_status, "running", "hot reload must not interrupt a retained process");
  assert.equal(await reloadedManager.runnerFromReq(new URL(`http://localhost/?runner=${runner.id}`)), runner);
  assert.equal("buffer" in runner, false, "durable replay must not retain a second in-memory copy");
  assert.deepEqual(await manager.replayRunnerEvents(runner), (await store.repositories.runnerEvents.list(runner.id)).map((event) => event.payload));

  await manager.defaultRunner();
  assert.equal((await store.repositories.runners.find(runner.id)).is_default, 1);
  assert.equal((await state.appSettings.hydrate()).defaultRunnerId, runner.id);
  processes[0].stdout.write(`${JSON.stringify({ type: "response", id: "state-response", success: true, command: "get_state", data: { sessionId: "session-1", sessionName: "Named runner" } })}\n`);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal((await store.repositories.runners.find(runner.id)).session_name, "Named runner");
  processes[0].stdout.write(`${JSON.stringify({ type: "extension_ui_request", id: "clarify", method: "input" })}\n`);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal((await store.repositories.runners.find(runner.id)).attention_status, "clarification");
  assert.equal((await store.repositories.runners.find(runner.id)).attention_unread, 1);
  assert.equal((await manager.replayRunnerEvents(runner)).some((payload) => JSON.parse(payload).id === "clarify"), true,
    "an unresolved extension prompt reopens after refresh");
  await manager.sendToRunner(runner, { type: "extension_ui_response", id: "clarify", value: "private" });
  assert.equal((await manager.replayRunnerEvents(runner)).some((payload) => JSON.parse(payload).id === "clarify"), false,
    "a resolved extension prompt does not reopen after refresh");
  manager.acknowledgeRunnerAttention(runner);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal((await store.repositories.runners.find(runner.id)).attention_unread, 0);
  processes[0].stdout.write(`${JSON.stringify({ type: "response", id: "oversized-response", success: true, data: "x".repeat(1024 * 1024) })}\n`);
  processes[0].stdout.write(`${JSON.stringify({ type: "message_update", message: { role: "assistant", content: "cumulative" } })}\n`);
  processes[0].stdout.write(`${JSON.stringify({ type: "tool_execution_update", toolCallId: "tool-1", partialResult: "cumulative" })}\n`);
  processes[0].stdout.write(`${JSON.stringify({ type: "agent_end", messages: [{ role: "assistant", content: "snapshot" }] })}\n`);
  processes[0].stdout.write(`${JSON.stringify({ type: "turn_end", message: { role: "assistant", content: "snapshot" } })}\n`);
  processes[0].stdout.write(`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: "terminal" } })}\n`);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  const replayedEvents = await store.repositories.runnerEvents.list(runner.id);
  const replayedTypes = replayedEvents.map((event) => JSON.parse(event.payload).type);
  assert.equal(replayedEvents.some((event) => event.payload.includes("oversized-response")), false);
  for (const type of ["response", "message_update", "tool_execution_update", "agent_end", "turn_end"]) {
    assert.equal(replayedTypes.includes(type), false, `${type} snapshots must not enter durable replay`);
  }
  assert.equal(replayedTypes.includes("message_end"), true, "bounded terminal events remain replayable");

  await manager.stopRunner(runner);
  persisted = await store.repositories.runners.find(runner.id);
  assert.equal(persisted.desired_state, "stopped");
  assert.equal(persisted.last_status, "stopped");
  assert.equal(persisted.last_stopped_at, "time");

  await store.repositories.sessions.delete(owner.id);
  assert.equal(await store.repositories.runners.find(runner.id), null, "session ownership cascades runner descriptors");
});

test("runner replay and selected workdir survive restart without eager process spawning", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-runner-restore-"));
  const databasePath = join(root, "app.sqlite");
  let store = await openAppStore({ databasePath });
  const sqlitePath = join(root, "agent.sqlite");
  const owner = await store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "restored-session", storagePath: sqlitePath, createdAt: "owner" });
  const runnerId = "r-restored000";
  await store.repositories.runners.create({
    id: runnerId, ownerId: owner.id, dir: "/persisted/workspace",
    sessionBackend: "sqlite", sessionId: "restored-session", sessionStoragePath: sqlitePath,
    sessionName: "Persisted name", isDefault: true, desiredState: "running", lastStatus: "running",
    startCount: 4, createdAt: "created", lastStartedAt: "previous-start",
  });
  await store.repositories.runnerEvents.append({ runnerId, sseId: "persisted-event-1", payload: '{"type":"persisted","part":1}', createdAt: "event-1" });
  await store.repositories.runnerEvents.append({ runnerId, sseId: "persisted-event-2", payload: '{"type":"persisted","part":2}', createdAt: "event-2" });
  await store.repositories.runnerEvents.append({ runnerId, sseId: "oversized-event", payload: "x".repeat(1024 * 1024 + 1), createdAt: "event-3" });
  await store.repositories.runners.create({
    id: "r-stopped0000", dir: "/stopped", desiredState: "stopped", lastStatus: "stopped", createdAt: "stopped-created", lastStoppedAt: "already-stopped",
  });
  await createAppSettings({ repository: store.repositories.settings, startupWorkdir: "/startup", now: () => "selected" })
    .setCurrentWorkdir("/persisted/workspace");
  await store.close();
  store = await openAppStore({ databasePath });
  const sessionReferences = createSessionReferenceCodec({ agentDir: root, jsonlRoot: join(root, "sessions"), sqlitePath });
  const hydratedSettings = await createAppSettings({ repository: store.repositories.settings, startupWorkdir: "/other" }).hydrate();
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
  const manager = await createRunnerManager(state, { appStore: store, now: () => "now" });
  t.after(async () => {
    clearInterval(state.runnerWatchdogTimer);
    clearInterval(state.runnerReaperTimer);
    await manager.stopPi();
    await store.close();
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
  const persistedFields = new Set(Object.keys(await store.repositories.runners.find(runnerId)));
  for (const field of RUNNER_EPHEMERAL_FIELDS) assert.equal(await persistedFields.has(field), false, `${field} must not be durable`);
  for (const field of RUNNER_MANAGER_EPHEMERAL_FIELDS) {
    assert.ok(state[field], `stable runtime state must own ${field}`);
    assert.equal(await persistedFields.has(field), false, `${field} must not be durable`);
  }
  assert.equal(state.defaultRunnerId, runnerId);
  assert.equal((await store.repositories.runners.find(runnerId)).last_status, "interrupted");
  assert.equal((await store.repositories.runners.find(runnerId)).desired_state, "stopped");
  assert.equal((await store.repositories.runners.find(runnerId)).last_stopped_at, "now");
  assert.equal((await store.repositories.runners.find("r-stopped0000")).last_status, "stopped");
  assert.equal((await store.repositories.runners.find("r-stopped0000")).last_stopped_at, "already-stopped");
  assert.deepEqual(await manager.replayRunnerEvents(restored), [
    '{"type":"persisted","part":1}', '{"type":"persisted","part":2}',
  ]);
  assert.deepEqual((await store.repositories.runnerEvents.list(runnerId)).map(({ sequence, sse_id }) => [sequence, sse_id]), [
    [1, "persisted-event-1"], [2, "persisted-event-2"], [3, "oversized-event"],
  ]);
  manager.startPi();
  assert.equal(spawnCount, 0, "server startup must not eagerly spawn restored runners");
  assert.equal(await manager.runnerFromReq(new URL(`http://localhost/?runner=${runnerId}`)), restored);
  assert.equal(spawnCount, 0, "descriptor lookup alone remains lazy");
  await manager.sendToRunner(restored, { type: "get_state" });
  assert.equal(spawnCount, 1, "the selected runner starts on first command demand");
  assert.ok(restored.proc);
  assert.ok(restored.stdoutReader);
  assert.equal(restored.startCount, 5);
});

test("runner replay events persist exact payloads and enforce their configured cap", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-runner-events-"));
  const databasePath = join(root, "app.sqlite");
  let store = await openAppStore({ databasePath });
  t.after(async () => { try { await store.close(); } catch {} rmSync(root, { recursive: true, force: true }); });
  await store.repositories.runners.create({ id: "r-events000", dir: "/workspace", desiredState: "stopped", lastStatus: "stopped", createdAt: "created" });
  for (let index = 1; index <= 5; index++) {
    await store.repositories.runnerEvents.append({
      runnerId: "r-events000", sseId: `event-${index}`, payload: JSON.stringify({ index }), createdAt: `time-${index}`, maxEntries: 3,
    });
  }
  assert.deepEqual((await store.repositories.runnerEvents.list("r-events000")).map((event) => [event.sequence, event.sse_id, event.payload]), [
    [3, "event-3", '{"index":3}'], [4, "event-4", '{"index":4}'], [5, "event-5", '{"index":5}'],
  ]);
  await store.repositories.runnerEvents.append({ runnerId: "r-events000", sseId: "event-5", payload: "duplicate", createdAt: "later", maxEntries: 3 });
  assert.equal((await store.repositories.runnerEvents.list("r-events000")).length, 3, "replayed SSE IDs are idempotent");
  const emptyId = await store.repositories.runnerEvents.append({ runnerId: "r-events000", sseId: "", payload: "empty ID", createdAt: "later", maxEntries: 3 });
  const replayedEmptyId = await store.repositories.runnerEvents.append({ runnerId: "r-events000", sseId: "", payload: "duplicate", createdAt: "latest", maxEntries: 3 });
  assert.deepEqual(replayedEmptyId, emptyId, "all non-null SSE IDs are idempotent");
  await store.close();
  store = await openAppStore({ databasePath });
  assert.deepEqual((await store.repositories.runnerEvents.list("r-events000")).map((event) => event.sequence), [4, 5, 6]);
  await store.repositories.runners.delete("r-events000");
  assert.deepEqual(await store.repositories.runnerEvents.list("r-events000"), []);
});

test("runner repository enforces one selected default", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-runner-default-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const create = async (id) => await store.repositories.runners.create({ id, dir: "/workspace", desiredState: "stopped", lastStatus: "stopped", createdAt: id });
  create("r-aaaaaaaa");
  create("r-bbbbbbbb");
  await store.repositories.runners.setDefault("r-aaaaaaaa");
  await store.repositories.runners.setDefault("r-bbbbbbbb");
  assert.equal((await store.repositories.runners.find("r-aaaaaaaa")).is_default, 0);
  assert.equal((await store.repositories.runners.find("r-bbbbbbbb")).is_default, 1);
  await assert.rejects(() => store.repositories.runners.update("r-aaaaaaaa", { is_default: 1 }), /unique constraint/i);
});

test("backend rollback ignores an incompatible persisted default runner without deleting it", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-runner-backend-toggle-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  const sqlitePath = join(root, "sessions.sqlite");
  const sessionReferences = createSessionReferenceCodec({ agentDir: root, jsonlRoot: join(root, "sessions"), sqlitePath });
  const owner = await store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "sqlite-session", storagePath: sqlitePath, createdAt: "owner" });
  await store.repositories.runners.create({
    id: "r-12345678-1234-4123-8123-123456789abc", ownerId: owner.id, dir: "/workspace", sessionBackend: "sqlite", sessionId: "sqlite-session",
    sessionStoragePath: sqlitePath, isDefault: true, desiredState: "stopped", lastStatus: "stopped", createdAt: "created",
  });
  const appSettings = createAppSettings({ repository: store.repositories.settings, startupWorkdir: "/workspace", now: () => "setting" });
  await appSettings.setDefaultRunnerId("r-12345678-1234-4123-8123-123456789abc");
  let spawnCount = 0;
  const state = {
    appStore: store, appSettings,
    config: { PI_BIN: "/pi", PI_EXTRA_ARGS: [], PERSISTENT_STORE: "jsonl" },
    currentDir: "/workspace", sseClients: new Set(), sessionReferences, serverEvent() {},
  };
  state.piProcesses = createPiProcessLauncher({ config: state.config, spawnImpl() { spawnCount++; return fakeProcess(); } });
  const manager = await createRunnerManager(state, {
    appStore: store, createRunnerId: () => "87654321-4321-4321-8321-cba987654321", now: () => "now",
  });
  t.after(async () => {
    clearInterval(state.runnerWatchdogTimer);
    clearInterval(state.runnerReaperTimer);
    await manager.stopPi();
    await store.close();
    rmSync(root, { recursive: true, force: true });
  });

  assert.equal(state.defaultRunnerId ?? null, null);
  assert.equal(spawnCount, 0);
  const selected = await manager.runnerFromReq(new URL("http://localhost/events?runner=r-12345678-1234-4123-8123-123456789abc"));
  assert.equal(selected.sessionRef, null);
  assert.notEqual(selected.id, "r-12345678-1234-4123-8123-123456789abc");
  assert.equal(spawnCount, 1, "a brand-new default session establishes its identity");
  assert.ok(await store.repositories.runners.find("r-12345678-1234-4123-8123-123456789abc"), "dormant SQLite descriptor survives a JSONL rollback toggle");
  assert.equal((await store.repositories.runners.find(selected.id)).session_backend, null);
});
