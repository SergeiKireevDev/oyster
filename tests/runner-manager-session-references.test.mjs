import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRunnerManager, PINNED_ARTIFACT_SYSTEM_PROMPT } from "../server/runners.mjs";
import { createPiProcessLauncher } from "../server/pi-processes.mjs";
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

async function setup(t, managerOptions = {}) {
  const spawns = [];
  const owners = [];
  const eventTimeline = [];
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
    serverEvent(event) { eventTimeline.push(event.type); },
  };
  state.piProcesses = createPiProcessLauncher({
    config: state.config,
    spawnImpl(bin, args, options) {
      const proc = fakeProcess();
      spawns.push({ bin, args, options, proc });
      return proc;
    },
  });
  const manager = await createRunnerManager(state, { ensureSessionOwner: (reference) => owners.push(reference), ...managerOptions });
  t.after(async () => {
    clearInterval(state.runnerWatchdogTimer);
    clearInterval(state.runnerReaperTimer);
    await manager.stopPi();
  });
  return { manager, sessionReferences, spawns, owners, state, sqlitePath, eventTimeline };
}

test("SQLite runners start and restart by ID with explicit store environment", async (t) => {
  const { manager, spawns, sqlitePath } = await setup(t);
  const sessionRef = { backend: "sqlite", id: "sqlite-one", storagePath: sqlitePath };
  const runner = await manager.spawnRunner({ dir: "/workspace", sessionRef });

  assert.deepEqual(spawns[0].args, [
    "--mode", "rpc", "--session", "sqlite-one", "--thinking", "off",
    "--append-system-prompt", PINNED_ARTIFACT_SYSTEM_PROMPT,
  ]);
  assert.match(PINNED_ARTIFACT_SYSTEM_PROMPT, /creates or materially updates a documentation or media file/);
  assert.match(PINNED_ARTIFACT_SYSTEM_PROMPT, /standalone HTML.*pinned_widget.*Pinned Widgets viewer/);
  assert.match(PINNED_ARTIFACT_SYSTEM_PROMPT, /HTML file is part of a web app.*do not automatically pin or open.*only offer.*wait for explicit user confirmation/);
  assert.match(PINNED_ARTIFACT_SYSTEM_PROMPT, /four or more.*group_pinned_widgets.*`group`.*`paths`.*dedicated pinned-widget group/);
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
  await manager.startRunner(runner);
  assert.deepEqual(spawns[1].args, spawns[0].args);
});

test("sending a prompt invokes session-family revival", async (t) => {
  const updates = [];
  const revived = [];
  const owner = { id: 7, archived: 1 };
  const appStore = { repositories: { sessions: {
    find: ({ backend, sessionId }) => backend === "sqlite" && sessionId === "archived-session" ? owner : null,
    setArchived: (id, archived) => updates.push([id, archived]),
  } } };
  const { manager, sqlitePath } = await setup(t, { appStore, unarchiveSession: (reference) => revived.push(reference) });
  const runner = await manager.spawnRunner({
    dir: "/workspace",
    sessionRef: { backend: "sqlite", id: "archived-session", storagePath: sqlitePath },
  });

  assert.equal(await manager.sendToRunner(runner, { type: "get_state" }), true);
  assert.deepEqual(updates, []);
  assert.deepEqual(revived, []);
  assert.equal(await manager.sendToRunner(runner, { type: "prompt", message: "continue" }), true);
  assert.deepEqual(updates, []);
  assert.deepEqual(revived, [{ backend: "sqlite", id: "archived-session", storagePath: sqlitePath }]);
});

test("managed child runners consume startup lineage arguments and expose their event stream", async (t) => {
  const { manager, spawns } = await setup(t);
  const runner = await manager.spawnRunner({
    dir: "/workspace",
    autostart: false,
    initialArgs: ["--parent-session", "parent-id", "--name", "Loop child"],
  });
  const events = [];
  const dispose = manager.observeRunner(runner, (event) => events.push(event.type));

  assert.equal(await manager.sendToRunner(runner, { type: "prompt", message: "work" }), true);
  assert.deepEqual(spawns[0].args.slice(0, 7), [
    "--mode", "rpc", "--parent-session", "parent-id", "--name", "Loop child", "--thinking",
  ]);
  spawns[0].proc.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["pi_started", "agent_start"]);

  dispose();
  spawns[0].proc.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["pi_started", "agent_start"]);
});

test("runner busy state follows compaction through the final settled event", async (t) => {
  const { manager, spawns } = await setup(t);
  const runner = await manager.spawnRunner({ dir: "/workspace" });
  const emit = async (event) => {
    spawns[0].proc.stdout.write(`${JSON.stringify(event)}\n`);
    await new Promise((resolve) => setImmediate(resolve));
  };

  await emit({ type: "agent_start" });
  assert.equal(manager.runnerInfo(runner).busy, true);
  await emit({ type: "agent_end", willRetry: false });
  assert.equal(manager.runnerInfo(runner).busy, false);
  await emit({ type: "compaction_start", reason: "threshold" });
  assert.equal(manager.runnerInfo(runner).busy, true);
  await emit({ type: "compaction_end", reason: "threshold", willRetry: false });
  assert.equal(manager.runnerInfo(runner).busy, true, "automatic compaction stays busy until post-run work settles");
  await emit({ type: "agent_settled" });
  assert.equal(manager.runnerInfo(runner).busy, false);

  await emit({ type: "compaction_start", reason: "manual" });
  await emit({ type: "compaction_end", reason: "manual", willRetry: false });
  assert.equal(manager.runnerInfo(runner).busy, false, "manual compaction settles without an agent run");
});

test("new runners use unique persistence-safe IDs that survive manager reconstruction", async (t) => {
  const { manager, state } = await setup(t);
  const first = await manager.spawnRunner({ dir: "/workspace" });
  const second = await manager.spawnRunner({ dir: "/workspace" });
  assert.match(first.id, /^r-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(second.id, /^r-[0-9a-f-]{36}$/);
  assert.notEqual(first.id, second.id);
  assert.equal("runnerSeq" in state, false, "IDs must not depend on a process-local counter");

  const reconstructed = await createRunnerManager(state, { ensureSessionOwner: () => null });
  assert.equal(await reconstructed.runnerFromReq(new URL(`http://localhost/?runner=${first.id}`)), first);
  assert.equal(state.runners.get(first.id), first);
  assert.equal(reconstructed.listRunnerInfo().some((runner) => runner.id === first.id), true);
});

test("stopping and immediately restarting does not let the old exit clobber the new reader", async (t) => {
  const timers = [];
  const { manager, spawns } = await setup(t, {
    setTimer(callback) {
      const timer = { callback, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer() {},
  });
  const runner = await manager.spawnRunner({ dir: "/workspace" });
  const oldProc = spawns[0].proc;

  await manager.stopRunner(runner);
  runner.lastSpawnAt = 0;
  await manager.startRunner(runner);
  const replacementReader = runner.stdoutReader;
  oldProc.emit("exit", 0, "SIGTERM");

  assert.equal(runner.proc, spawns[1].proc);
  assert.equal(runner.stdoutReader, replacementReader);
  timers.find((timer) => timer.callback)?.callback();
  assert.equal(oldProc.signal, "SIGKILL", "a signalled child that has not exited is forcibly killed");
});

test("a pending crash-loop restart is cancelled when a dormant runner is stopped", async (t) => {
  const timers = [];
  const cleared = [];
  const { manager, spawns } = await setup(t, {
    setTimer(callback) {
      const timer = { callback, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) { if (timer) cleared.push(timer); },
  });
  const runner = await manager.spawnRunner({ dir: "/workspace" });
  spawns[0].proc.emit("exit", 1, null);
  await manager.startRunner(runner);
  const pending = runner.startTimer;

  await manager.stopRunner(runner);
  assert.equal(runner.startTimer, null);
  assert.ok(cleared.includes(pending));
  pending.callback();
  assert.equal(spawns.length, 1, "the cancelled callback cannot revive a stopped runner");
});

test("synchronous process launch failures leave a dead, reusable descriptor", async (t) => {
  const { manager, state } = await setup(t, {
    spawnImpl() { throw new Error("spawn unavailable"); },
  });

  const runner = await manager.spawnRunner({ dir: "/workspace" });
  assert.equal(runner.proc, null);
  assert.equal(state.runners.get(runner.id), runner);
  assert.equal(manager.runnerInfo(runner).alive, false);
});

test("runner manager validates callback-facing state boundaries", async () => {
  await assert.rejects(() => createRunnerManager(null), /runner state is required/);
  await assert.rejects(() => createRunnerManager({ config: {}, sessionReferences: {}, serverEvent() {}, sseClients: [] }), /sseClients must be a Set/);
});

test("runner ID generation rejects collisions instead of replacing a durable descriptor", async (t) => {
  const { state } = await setup(t);
  const manager = await createRunnerManager(state, { createRunnerId: () => "same-runner-token", ensureSessionOwner: () => null });
  await manager.spawnRunner({ dir: "/workspace" });
  await assert.rejects(() => manager.spawnRunner({ dir: "/other" }), /repeatedly returned an existing ID/);
  assert.equal(state.runners.size, 1);
});

test("opening a stopped session stays dormant until a message is sent", async (t) => {
  const { manager, sqlitePath, spawns, state, eventTimeline } = await setup(t);
  const sessionRef = { backend: "sqlite", id: "read-only", storagePath: sqlitePath };

  const runner = await manager.openSessionRunner({ sessionRef, dir: "/workspace" });
  state.sseClients.add({
    runnerId: runner.id,
    writableEnded: false,
    destroyed: false,
    write(chunk) {
      const line = String(chunk).split("\n").find((part) => part.startsWith("data: "));
      if (line) eventTimeline.push(JSON.parse(line.slice(6)).type);
    },
  });
  assert.equal(runner.proc, null);
  assert.equal(spawns.length, 0);
  assert.equal(await manager.openSessionRunner({ sessionRef }), runner);
  assert.equal(spawns.length, 0);

  assert.equal(await manager.sendToRunner(runner, { type: "prompt", message: "hello" }), true);
  assert.equal(spawns.length, 1);
  assert.equal(runner.proc, spawns[0].proc);
  assert.deepEqual(eventTimeline.slice(0, 2), ["runners_update", "pi_started"], "liveness must publish before revival");

  await manager.stopRunner(runner);
  runner.lastSpawnAt = 0;
  assert.equal(await manager.openSessionRunner({ sessionRef }), runner);
  assert.equal(runner.proc, null);
  assert.equal(spawns.length, 1, "reopening for reading must not revive pi");
  assert.equal(await manager.sendToRunner(runner, { type: "prompt", message: "again" }), true);
  assert.equal(spawns.length, 2, "sending a message revives pi");
});

test("runner deduplication compares the full reference, not the shared SQLite path", async (t) => {
  const { manager, sqlitePath, owners, state } = await setup(t);
  const firstRef = { backend: "sqlite", id: "first", storagePath: sqlitePath };
  const secondRef = { backend: "sqlite", id: "second", storagePath: sqlitePath };
  const first = await manager.openSessionRunner({ sessionRef: firstRef, dir: "/workspace" });
  assert.equal(await manager.openSessionRunner({ sessionRef: { ...firstRef } }), first);
  const second = await manager.openSessionRunner({ sessionRef: secondRef, dir: "/workspace" });
  assert.notEqual(second, first);
  assert.equal(state.runners.size, 2);
  assert.deepEqual(owners, [firstRef, secondRef]);
});

test("unnamed sessions are titled by their configured model from catalog messages", async (t) => {
  const titleCalls = [];
  const { manager, spawns, state, sqlitePath } = await setup(t, {
    summarizeTitle: async (_piProcesses, options) => { titleCalls.push(options); return "Repair OAuth Redirects"; },
  });
  const messages = Array.from({ length: 11 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `message ${index + 1}` }));
  state.sessionCatalog = { messages: () => ({ messages }) };
  const runner = await manager.spawnRunner({
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

test("JSONL runners retain file compatibility and switch-session startup", async (t) => {
  const { manager, spawns, state } = await setup(t);
  state.config.PERSISTENT_STORE = "jsonl";
  const sessionRef = {
    backend: "jsonl",
    id: "jsonl-one",
    storagePath: "/agent/sessions/--workspace--/one.jsonl",
  };
  const runner = await manager.spawnRunner({ dir: "/workspace", sessionRef });
  const written = spawns[0].proc.stdin.read().toString();
  const command = JSON.parse(written.trim());
  assert.equal(spawns[0].args.includes("--session"), false);
  assert.equal(command.type, "switch_session");
  assert.equal(command.sessionPath, sessionRef.storagePath);
  assert.equal(manager.runnerInfo(runner).sessionFile, sessionRef.storagePath);
  assert.ok(runner.resumeTimer);
  await manager.sendToRunner(runner, { type: "prompt", message: "queued" });
  assert.equal(runner.resumeQueue.length, 1);
  await manager.stopRunner(runner);
  assert.equal(runner.resumeId, null);
  assert.equal(runner.resumeTimer, null);
  assert.deepEqual(runner.resumeQueue, []);
});
