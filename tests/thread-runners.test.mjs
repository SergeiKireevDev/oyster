import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRunnerManager, MAX_IDLE_RUNNER_MS } from "../server/runners.mjs";
import { createNativeTranscriptSink } from "../server/persistence/nativeTranscriptSink.mjs";
import { createPiProcessLauncher } from "../server/pi-processes.mjs";
import { createClaudeCodeDriver } from "../server/runner-drivers/claude-code.mjs";
import { createCodexDriver } from "../server/runner-drivers/codex.mjs";
import { createPiRpcDriver } from "../server/runner-drivers/pi-rpc.mjs";
import { createSessionReferenceCodec } from "../server/session-references.mjs";

const SQLITE_PATH = "/agent/sessions.sqlite";
const HOUR_MS = 60 * 60 * 1000;

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.exitCode = null;
  proc.kill = (signal) => { proc.signal = signal; };
  return proc;
}

async function setup(t, managerOptions = {}) {
  const spawns = [];
  const sessionReferences = createSessionReferenceCodec({ agentDir: "/agent", jsonlRoot: "/agent/sessions", sqlitePath: SQLITE_PATH });
  const state = {
    config: { PI_BIN: "/local/pi", PI_EXTRA_ARGS: [], PERSISTENT_STORE: "sqlite", SQLITE_PATH },
    currentDir: "/workspace",
    runners: new Map(),
    sseClients: new Set(),
    sessionReferences,
    serverEvent() {},
  };
  state.piProcesses = createPiProcessLauncher({
    config: state.config,
    spawnImpl: (bin, args) => {
      const proc = fakeProcess();
      spawns.push({ bin, args, proc });
      return proc;
    },
  });
  const runnerDriver = createPiRpcDriver({ config: state.config, processLauncher: state.piProcesses });
  const manager = await createRunnerManager(state, { ensureSessionOwner: () => null, runnerDriver, ...managerOptions });
  t.after(async () => {
    clearInterval(state.runnerWatchdogTimer);
    clearInterval(state.runnerReaperTimer);
    await manager.stopPi();
  });
  return { manager, state, spawns };
}

test("every agent process is stopped after two idle hours and restarts on the next command", async (t) => {
  assert.equal(MAX_IDLE_RUNNER_MS, 2 * HOUR_MS);
  const { manager, spawns } = await setup(t);
  const runner = await manager.spawnRunner({ dir: "/workspace" });
  runner.sessionName = "a named, well-used session";
  assert.ok(runner.proc);

  // Recently used: left alone, however long ago it was spawned.
  runner.lastSpawnAt = Date.now() - 5 * HOUR_MS;
  runner.lastActivityAt = Date.now() - HOUR_MS;
  await manager.reapIdleRunners();
  assert.ok(runner.proc);

  // Busy or waiting on the user is not idle, whatever the clock says.
  runner.lastActivityAt = Date.now() - 3 * HOUR_MS;
  runner.busy = true;
  await manager.reapIdleRunners();
  assert.ok(runner.proc);
  runner.busy = false;
  runner.pendingExtensionUiRequestIds.add("question-1");
  await manager.reapIdleRunners();
  assert.ok(runner.proc);
  runner.pendingExtensionUiRequestIds.clear();

  await manager.reapIdleRunners();
  assert.equal(runner.proc, null);
  assert.equal(spawns[0].proc.signal, "SIGTERM");
  assert.equal(manager.runnerInfo(runner).alive, false);

  // The descriptor survives: the next prompt starts a fresh process for the same session.
  assert.equal(await manager.sendToRunner(runner, { type: "prompt", message: "still there?" }), true);
  assert.equal(spawns.length, 2);
  assert.ok(runner.proc);
  assert.ok(Date.now() - runner.lastActivityAt < HOUR_MS);
});

test("state reads and health probes do not count as use, but work does", async (t) => {
  const { manager } = await setup(t, { maxIdleMs: 1000 });
  const runner = await manager.spawnRunner({ dir: "/workspace" });
  const stale = Date.now() - 5000;
  runner.lastSpawnAt = stale;
  runner.lastActivityAt = stale;

  await manager.sendToRunner(runner, { id: "c1", type: "get_state" });
  await manager.sendToRunner(runner, { id: "c2", type: "get_messages" });
  runner.proc.stdout.write(`${JSON.stringify({ type: "response", id: "c1", command: "get_state", success: true, data: { sessionId: "s", isStreaming: false } })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runner.lastActivityAt, stale);

  runner.proc.stdout.write(`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [] } })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(runner.lastActivityAt > stale);
  await manager.reapIdleRunners();
  assert.ok(runner.proc);
});

test("runner listings include described lineage and survive a failing describer", async (t) => {
  let fail = false;
  const { manager } = await setup(t, {
    describeRunner: (runner) => {
      if (fail) throw new Error("registry offline");
      return runner.threadId ? { thread: { id: runner.threadId, parentSessionKey: "p", rootSessionKey: "r" } } : null;
    },
  });
  const runner = await manager.spawnRunner({ dir: "/workspace", autostart: false });
  assert.equal(manager.runnerInfo(runner).thread, undefined);
  runner.threadId = "t1";
  assert.deepEqual(manager.runnerInfo(runner).thread, { id: "t1", parentSessionKey: "p", rootSessionKey: "r" });
  fail = true;
  const errors = [];
  t.mock.method(console, "error", (line) => errors.push(line));
  assert.equal(manager.runnerInfo(runner).thread, undefined);
  assert.match(errors[0], /cannot describe runner .*registry offline/);
});

test("a thread runner keeps its fork source until the harness reports the session", async (t) => {
  const { manager, state } = await setup(t);
  const sessionRef = { backend: "sqlite", id: "fork-1", storagePath: SQLITE_PATH };
  const forkSource = { sessionId: "parent-1", entryId: "leaf", model: null };
  const runner = await manager.spawnRunner({ dir: "/workspace", sessionRef, autostart: false, sessionInitialized: false, forkSource });
  assert.equal(runner.sessionInitialized, false);
  assert.deepEqual(runner.forkSource, forkSource);
  assert.equal(runner.proc, null);

  await manager.startRunner(runner);
  runner.proc.stdout.write(`${JSON.stringify({ type: "response", id: "x", command: "get_state", success: true, data: { sessionId: "fork-1", sessionInitialized: false } })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(runner.forkSource, forkSource);
  runner.proc.stdout.write(`${JSON.stringify({ type: "response", id: "y", command: "get_state", success: true, data: { sessionId: "fork-1" } })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runner.forkSource, null);
  assert.equal(runner.sessionInitialized, true);
  assert.equal(state.runners.get(runner.id), runner);
});

function launchArgs(driver, runner) {
  let spawned = null;
  const instance = driver({ spawnImpl: (bin, args, options) => { spawned = { bin, args, options }; return fakeProcess(); } });
  instance.launch({ runner, cwd: "/workspace", systemPrompt: "" });
  return { ...spawned, instance };
}

test("Claude Code forks the parent session on a thread's first launch only", () => {
  const sessionRef = { backend: "sqlite", id: "11111111-1111-4111-8111-111111111111", storagePath: SQLITE_PATH };
  const driver = (options) => createClaudeCodeDriver({ bin: "/opt/claude", sqlitePath: SQLITE_PATH, extraArgs: ["--model", "configured"], ...options });

  const thread = { id: "r-1", sessionRef, sessionInitialized: false, forkSource: { sessionId: "parent-session", model: { id: "claude-parent" }, thinkingLevel: "high" } };
  const { args } = launchArgs(driver, thread);
  // The parent's thinking level carries over, and is kept for later launches of the thread.
  assert.deepEqual(args.slice(args.indexOf("--effort"), args.indexOf("--effort") + 2), ["--effort", "high"]);
  assert.equal(thread.driverRuntime.selectedEffort, "high");
  const resume = args.indexOf("--resume");
  assert.deepEqual(args.slice(resume, resume + 5), ["--resume", "parent-session", "--fork-session", "--session-id", sessionRef.id]);
  // The parent's model follows the configured arguments so it wins.
  assert.deepEqual(args.slice(-2), ["--model", "claude-parent"]);

  // Once the fork exists it is resumed like any other session.
  const resumed = launchArgs(driver, { id: "r-1", sessionRef, sessionInitialized: true, forkSource: null }).args;
  assert.deepEqual(resumed.slice(resumed.indexOf("--resume"), resumed.indexOf("--resume") + 2), ["--resume", sessionRef.id]);
  assert.equal(resumed.includes("--fork-session"), false);
  assert.equal(resumed.includes("claude-parent"), false);

  // An ordinary new session is created empty.
  const fresh = launchArgs(driver, { id: "r-2", sessionRef, sessionInitialized: false }).args;
  assert.equal(fresh.includes("--fork-session"), false);
  assert.equal(fresh[fresh.indexOf("--session-id") + 1], sessionRef.id);
  assert.equal(createClaudeCodeDriver({ bin: "/opt/claude" }).threadFork, "tip");
});

test("Codex forks on the first turn of a thread and copies the inherited transcript", async () => {
  const batches = [];
  const transcriptSink = { append: async (batch) => { batches.push(batch); return { appended: batch.entries.length }; } };
  const sessionRef = { backend: "sqlite", id: "provisional", storagePath: SQLITE_PATH };
  const runner = {
    id: "r-1", dir: "/workspace", sessionRef, sessionInitialized: false,
    forkSource: { sessionId: "parent-thread", entryId: "leaf-entry", model: { id: "gpt-parent" } },
  };
  const { instance: driver } = launchArgs((options) => createCodexDriver({ bin: "/opt/codex", sqlitePath: SQLITE_PATH, transcriptSink, ...options }), runner);
  assert.equal(driver.threadFork, "tip");

  const child = fakeProcess();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(JSON.parse(String(chunk))));
  driver.sendCommand(runner, child, { id: "p1", type: "prompt", message: "> quoted\n\nwhy?" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(written[0].fork, "parent-thread");
  assert.equal(written[0].resume, false);
  assert.equal(written[0].model, "gpt-parent");

  // Codex names the copy; from then on the thread is resumed, never forked again.
  driver.decodeLine(runner, JSON.stringify({ type: "thread.started", thread_id: "native-fork" }));
  driver.sendCommand(runner, child, { id: "p2", type: "prompt", message: "and then?" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(Object.hasOwn(written[1], "fork"), false);
  assert.deepEqual([written[1].resume, written[1].sessionId], [true, "native-fork"]);

  await runner.driverRuntime.transcriptPending;
  assert.ok(batches.length >= 1);
  assert.deepEqual(batches[0].forkFrom, { sessionId: "parent-thread", entryId: "leaf-entry" });
  assert.equal(batches[0].sessionId, "native-fork");

  // With no model named by the browser the driver falls back to what Codex recorded for the
  // parent, and still forks when that is unknown too.
  const unknown = { id: "r-3", dir: "/workspace", sessionRef, sessionInitialized: false, forkSource: { sessionId: "parent-without-rollout", entryId: null, model: null } };
  const { instance: unknownDriver } = launchArgs((options) => createCodexDriver({ bin: "/opt/codex", sqlitePath: SQLITE_PATH, bridgeOptions: { codexHome: "/nonexistent-codex-home" }, ...options }), unknown);
  const unknownChild = fakeProcess();
  const unknownWritten = [];
  unknownChild.stdin.on("data", (chunk) => unknownWritten.push(JSON.parse(String(chunk))));
  unknownDriver.sendCommand(unknown, unknownChild, { id: "p", type: "prompt", message: "why?" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(unknownWritten[0].fork, "parent-without-rollout");
  assert.deepEqual(unknown.driverRuntime.forkedFrom, { sessionId: "parent-without-rollout", entryId: null });

  // Harnesses without a fork command never advertise or attempt one.
  const plain = { id: "r-2", dir: "/workspace", sessionRef: null };
  const { instance: fresh } = launchArgs((options) => createCodexDriver({ bin: "/opt/codex", ...options }), plain);
  const plainChild = fakeProcess();
  const plainWritten = [];
  plainChild.stdin.on("data", (chunk) => plainWritten.push(JSON.parse(String(chunk))));
  fresh.sendCommand(plain, plainChild, { id: "p", type: "prompt", message: "hi" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(Object.hasOwn(plainWritten[0], "fork"), false);
});

test("the native transcript sink creates a thread's transcript as a copy of its source", async () => {
  const calls = [];
  const session = (id, metadata) => ({
    getMetadata: async () => ({ id, metadata }),
    getEntry: async () => null,
    getStorage: () => ({ appendEntry: async (entry) => calls.push(["append", id, entry.id]), getLeafId: async () => "leaf" }),
    getSessionName: async () => null,
    appendSessionName: async () => {},
    close: async () => {},
  });
  const repository = (overrides = {}) => ({
    openById: async () => { throw Object.assign(new Error("Session not found"), { code: "not_found" }); },
    create: async (options) => { calls.push(["create", options.id]); return session(options.id, options.metadata); },
    fork: async (sourceId, options) => { calls.push(["fork", sourceId, options.id, options.entryId ?? null, options.position ?? null]); return session(options.id, options.metadata); },
    ...overrides,
  });
  const batch = (extra) => ({ harness: "codex", sessionId: "native-fork", cwd: "/workspace", name: null, entries: [{ id: "e1", message: { role: "user", content: "why?" } }], ...extra });

  await createNativeTranscriptSink({ sqlitePath: SQLITE_PATH, repositoryFactory: () => repository() })
    .append(batch({ forkFrom: { sessionId: "parent-thread", entryId: "leaf-entry" } }));
  assert.deepEqual(calls, [["fork", "parent-thread", "native-fork", "leaf-entry", "at"], ["append", "native-fork", "e1"]]);

  // Ordinary sessions are created empty.
  calls.length = 0;
  await createNativeTranscriptSink({ sqlitePath: SQLITE_PATH, repositoryFactory: () => repository() }).append(batch());
  assert.deepEqual(calls, [["create", "native-fork"], ["append", "native-fork", "e1"]]);

  // A source that cannot be copied costs the inherited history, never the thread's own messages.
  calls.length = 0;
  const errors = [];
  const original = console.error;
  console.error = (line) => errors.push(line);
  try {
    await createNativeTranscriptSink({ sqlitePath: SQLITE_PATH, repositoryFactory: () => repository({ fork: async () => { throw new Error("source vanished"); } }) })
      .append(batch({ forkFrom: { sessionId: "parent-thread", entryId: null } }));
  } finally { console.error = original; }
  assert.deepEqual(calls, [["create", "native-fork"], ["append", "native-fork", "e1"]]);
  assert.match(errors[0], /cannot copy parent-thread into forked transcript native-fork: source vanished/);
});
