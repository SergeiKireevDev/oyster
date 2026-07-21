import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRunnerManager } from "../runners.mjs";
import { createPiProcessLauncher } from "../pi-processes.mjs";
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

function setup(t, managerOptions = {}) {
  const spawns = [];
  const owners = [];
  const sqlitePath = "/agent/sessions.sqlite";
  const sessionReferences = createSessionReferenceCodec({
    agentDir: "/agent",
    jsonlRoot: "/agent/sessions",
    sqlitePath,
  });
  const state = {
    config: {
      PI_BIN: "/local/pi",
      PI_EXTRA_ARGS: ["--thinking", "off"],
      PERSISTENT_STORE: "sqlite",
      SQLITE_PATH: sqlitePath,
    },
    currentDir: "/workspace",
    runners: new Map(),
    sseClients: new Set(),
    sessionReferences,
    serverEvent() {},
  };
  state.piProcesses = createPiProcessLauncher({
    config: state.config,
    spawnImpl(bin, args, options) {
      const proc = fakeProcess();
      spawns.push({ bin, args, options, proc });
      return proc;
    },
  });
  const manager = createRunnerManager(state, { ensureSessionOwner: (reference) => owners.push(reference), ...managerOptions });
  t.after(() => {
    clearInterval(state.runnerWatchdogTimer);
    clearInterval(state.runnerReaperTimer);
    manager.stopPi();
  });
  return { manager, sessionReferences, spawns, owners, state, sqlitePath };
}

test("SQLite runners start and restart by ID with explicit store environment", (t) => {
  const { manager, spawns, sqlitePath } = setup(t);
  const sessionRef = { backend: "sqlite", id: "sqlite-one", storagePath: sqlitePath };
  const runner = manager.spawnRunner({ dir: "/workspace", sessionRef });

  assert.deepEqual(spawns[0].args, ["--mode", "rpc", "--session", "sqlite-one", "--thinking", "off"]);
  assert.equal(spawns[0].options.env.PERSISTENT_STORE, "sqlite");
  assert.equal(runner.resumeId, null);
  assert.deepEqual(manager.runnerInfo(runner), {
    id: runner.id,
    dir: "/workspace",
    sessionRef,
    sessionKey: manager.runnerInfo(runner).sessionKey,
    sessionFile: null,
    sessionId: "sqlite-one",
    sessionName: null,
    busy: false,
    alive: true,
  });

  spawns[0].proc.emit("exit", 1, null);
  runner.lastSpawnAt = 0;
  manager.startRunner(runner);
  assert.deepEqual(spawns[1].args, spawns[0].args);
});

test("new runners use unique persistence-safe IDs that survive manager reconstruction", (t) => {
  const { manager, state } = setup(t);
  const first = manager.spawnRunner({ dir: "/workspace" });
  const second = manager.spawnRunner({ dir: "/workspace" });
  assert.match(first.id, /^r-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(second.id, /^r-[0-9a-f-]{36}$/);
  assert.notEqual(first.id, second.id);
  assert.equal("runnerSeq" in state, false, "IDs must not depend on a process-local counter");

  const reconstructed = createRunnerManager(state, { ensureSessionOwner: () => null });
  assert.equal(reconstructed.runnerFromReq(new URL(`http://localhost/?runner=${first.id}`)), first);
  assert.equal(state.runners.get(first.id), first);
  assert.equal(reconstructed.listRunnerInfo().some((runner) => runner.id === first.id), true);
});

test("runner ID generation rejects collisions instead of replacing a durable descriptor", (t) => {
  const { state } = setup(t);
  const manager = createRunnerManager(state, { createRunnerId: () => "same-runner-token", ensureSessionOwner: () => null });
  manager.spawnRunner({ dir: "/workspace" });
  assert.throws(() => manager.spawnRunner({ dir: "/other" }), /repeatedly returned an existing ID/);
  assert.equal(state.runners.size, 1);
});

test("runner deduplication compares the full reference, not the shared SQLite path", (t) => {
  const { manager, sqlitePath, owners, state } = setup(t);
  const firstRef = { backend: "sqlite", id: "first", storagePath: sqlitePath };
  const secondRef = { backend: "sqlite", id: "second", storagePath: sqlitePath };
  const first = manager.openSessionRunner({ sessionRef: firstRef, dir: "/workspace" });
  assert.equal(manager.openSessionRunner({ sessionRef: { ...firstRef } }), first);
  const second = manager.openSessionRunner({ sessionRef: secondRef, dir: "/workspace" });
  assert.notEqual(second, first);
  assert.equal(state.runners.size, 2);
  assert.deepEqual(owners, [firstRef, secondRef]);
});

test("unnamed sessions are titled by their configured model from catalog messages", async (t) => {
  const titleCalls = [];
  const { manager, spawns, state, sqlitePath } = setup(t, {
    summarizeTitle: async (_piProcesses, options) => { titleCalls.push(options); return "Repair OAuth Redirects"; },
  });
  const messages = Array.from({ length: 11 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `message ${index + 1}` }));
  state.sessionCatalog = { messages: () => ({ messages }) };
  const runner = manager.spawnRunner({
    dir: "/workspace",
    sessionRef: { backend: "sqlite", id: "title-session", storagePath: sqlitePath },
  });
  spawns[0].proc.stdout.write(`${JSON.stringify({
    type: "response", id: "state", success: true, command: "get_state",
    data: { sessionId: "title-session", sessionName: null, messageCount: 11, model: { provider: "mock", id: "configured" } },
  })}\n`);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  assert.equal(titleCalls.length, 1);
  assert.deepEqual(titleCalls[0].model, { provider: "mock", id: "configured" });
  assert.equal(titleCalls[0].messages.length, 10);
  assert.equal(titleCalls[0].messages.at(-1).content, "message 10");
  assert.equal(runner.sessionName, "Repair OAuth Redirects");
  const commands = spawns[0].proc.stdin.read().toString().trim().split("\n").map(JSON.parse);
  assert.ok(commands.some((command) => command.type === "set_session_name" && command.name === "Repair OAuth Redirects"));

  spawns[0].proc.stdout.write(`${JSON.stringify({
    type: "response", id: "state-2", success: true, command: "get_state",
    data: { sessionId: "title-session", sessionName: "Manual title", messageCount: 12, model: { provider: "mock", id: "configured" } },
  })}\n`);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(titleCalls.length, 1, "named sessions are not retitled");
});

test("JSONL runners retain file compatibility and switch-session startup", (t) => {
  const { manager, spawns, state } = setup(t);
  state.config.PERSISTENT_STORE = "jsonl";
  const sessionRef = {
    backend: "jsonl",
    id: "jsonl-one",
    storagePath: "/agent/sessions/--workspace--/one.jsonl",
  };
  const runner = manager.spawnRunner({ dir: "/workspace", sessionRef });
  const written = spawns[0].proc.stdin.read().toString();
  const command = JSON.parse(written.trim());
  assert.equal(spawns[0].args.includes("--session"), false);
  assert.equal(command.type, "switch_session");
  assert.equal(command.sessionPath, sessionRef.storagePath);
  assert.equal(manager.runnerInfo(runner).sessionFile, sessionRef.storagePath);
  assert.ok(runner.resumeTimer);
  manager.sendToRunner(runner, { type: "prompt", message: "queued" });
  assert.equal(runner.resumeQueue.length, 1);
  manager.stopRunner(runner);
  assert.equal(runner.resumeId, null);
  assert.equal(runner.resumeTimer, null);
  assert.deepEqual(runner.resumeQueue, []);
});
