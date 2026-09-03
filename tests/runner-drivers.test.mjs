import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { validateRunnerDriver } from "../server/runner-drivers/contract.mjs";
import { createPiRpcDriver } from "../server/runner-drivers/pi-rpc.mjs";
import { createRunnerDriverRegistry } from "../server/runner-drivers/registry.mjs";
import { createRunnerManager } from "../server/runners.mjs";
import { createSessionReferenceCodec } from "../server/session-references.mjs";

function fakeProcess() {
  const process = new EventEmitter();
  process.stdin = new PassThrough();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.exitCode = null;
  process.kill = () => {};
  return process;
}

function writtenLines(stream) {
  return String(stream.read() ?? "").trim().split("\n").filter(Boolean).map(JSON.parse);
}

test("runner driver contract rejects incomplete adapters", () => {
  assert.throws(() => validateRunnerDriver(null), /runner driver is required/);
  assert.throws(() => validateRunnerDriver({ id: "" }), /runner driver id is required/);
  assert.throws(() => validateRunnerDriver({ id: "partial" }), /requires isSessionCompatible\(\)/);
});

test("pi RPC driver owns pi arguments, NDJSON commands, resume, and state identity", () => {
  const launches = [];
  const process = fakeProcess();
  const driver = createPiRpcDriver({
    config: {
      PI_BIN: "/bin/pi",
      PI_EXTRA_ARGS: ["--thinking", "off"],
      PERSISTENT_STORE: "sqlite",
      SQLITE_PATH: "/agent/sessions.sqlite",
    },
    processLauncher: {
      bin: "/bin/pi",
      launch(args, options) { launches.push({ args, options }); return process; },
    },
  });
  const runner = { sessionRef: { backend: "sqlite", id: "session-1", storagePath: "/agent/sessions.sqlite" } };

  const launched = driver.launch({ runner, initialArgs: ["--name", "Child"], cwd: "/work", systemPrompt: "policy" });
  assert.equal(launched.process, process);
  assert.deepEqual(launches[0], {
    args: [
      "--mode", "rpc", "--session", "session-1", "--name", "Child",
      "--thinking", "off", "--append-system-prompt", "policy",
    ],
    options: { cwd: "/work", stdio: ["pipe", "pipe", "pipe"] },
  });
  assert.deepEqual(driver.decodeLine(runner, '{"type":"agent_start"}'), [{ type: "agent_start" }]);
  assert.deepEqual(driver.decodeLine(runner, "diagnostic output"), []);
  assert.equal(driver.sendCommand(runner, process, { type: "prompt", message: "hello" }), true);
  assert.deepEqual(writtenLines(process.stdin), [{ type: "prompt", message: "hello" }]);
  assert.deepEqual(driver.startup({ runner, requestId: "state-1" }), {
    commands: [{ id: "state-1", type: "get_state" }],
    resumeResponseId: null,
  });
  assert.deepEqual(driver.sessionReference({ sessionId: "session-1" }), {
    backend: "sqlite", id: "session-1", storagePath: "/agent/sessions.sqlite",
  });

  const jsonlRunner = { sessionRef: { backend: "jsonl", id: "jsonl-1", storagePath: "/agent/sessions/one.jsonl" } };
  assert.deepEqual(driver.startup({ runner: jsonlRunner, requestId: "resume-1" }), {
    commands: [{ id: "resume-1", type: "switch_session", sessionPath: "/agent/sessions/one.jsonl" }],
    resumeResponseId: "resume-1",
  });
});

test("runner manager selects and persists a harness per runner", async (t) => {
  const launches = [];
  const rows = [];
  const events = [];
  const makeDriver = (id, backend) => ({
    id, label: id,
    isSessionCompatible: (reference) => !reference || reference.backend === backend,
    launch({ runner }) { const process = fakeProcess(); launches.push({ id, runner, process }); return { process, description: id }; },
    decodeLine(_runner, line) { return [JSON.parse(line)]; },
    sendCommand(_runner, process, command) { process.stdin.write(`${JSON.stringify(command)}\n`); return true; },
    stateCommand: (requestId) => ({ id: requestId, type: "get_state" }),
    startup: ({ requestId }) => ({ commands: [{ id: requestId, type: "get_state" }], resumeResponseId: null }),
    sessionReference(state, current) { return state.sessionId ? { backend, id: state.sessionId, storagePath: backend === "claude-code" ? null : "/agent/sessions.sqlite" } : current; },
  });
  const registry = createRunnerDriverRegistry({ drivers: [makeDriver("pi", "sqlite"), makeDriver("claude-code", "claude-code")], defaultId: "pi" });
  const state = {
    config: {}, currentDir: "/work", runners: new Map(), sseClients: new Set(), serverEvent() {},
    sessionReferences: createSessionReferenceCodec({ agentDir: "/agent", jsonlRoot: "/agent/sessions", sqlitePath: "/agent/sessions.sqlite" }),
  };
  const appStore = { repositories: { runners: {
    list: async () => [],
    create: async (row) => rows.push(row),
    update: async (_id, changes) => events.push(changes),
  } } };
  const manager = await createRunnerManager(state, { appStore, runnerDrivers: registry, ensureSessionOwner: () => ({ id: 7 }) });
  t.after(async () => { clearInterval(state.runnerWatchdogTimer); clearInterval(state.runnerReaperTimer); await manager.stopPi(); });

  const runner = await manager.spawnRunner({ dir: "/work", harness: "claude-code" });
  assert.equal(runner.harness, "claude-code");
  assert.equal(launches[0].id, "claude-code");
  assert.equal(rows[0].harness, "claude-code");
  launches[0].process.stdout.write(`${JSON.stringify({ type: "response", id: "state", command: "get_state", success: true, data: { sessionId: "cc-1" } })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(runner.sessionRef, { backend: "claude-code", id: "cc-1", storagePath: null });
  assert.equal(events.some((change) => change.session_backend === "claude-code"), true);
});

test("runner manager is driven by a non-pi process and protocol adapter", async (t) => {
  const process = fakeProcess();
  const launched = [];
  const commands = [];
  const requestIds = new WeakMap();
  const driver = {
    id: "synthetic-stream",
    label: "synthetic agent",
    isSessionCompatible: (reference) => !reference || reference.backend === "sqlite",
    launch(options) { launched.push(options); return { process, description: "synthetic --stream" }; },
    decodeLine(runner, line) {
      const message = JSON.parse(line);
      if (message.kind === "initialized") return [{
        type: "response",
        id: requestIds.get(runner),
        command: "get_state",
        success: true,
        data: { sessionId: message.session, sessionName: null, messageCount: 0, isStreaming: false },
      }];
      if (message.kind === "started") return [{ type: "agent_start" }];
      if (message.kind === "settled") return [{ type: "agent_settled" }];
      return [];
    },
    sendCommand(_runner, _process, command) {
      commands.push(command.type === "prompt"
        ? { kind: "user", text: command.message }
        : { kind: "state", correlation: command.id });
      return true;
    },
    stateCommand: (id) => ({ id, type: "driver_state" }),
    startup({ runner, requestId }) {
      requestIds.set(runner, requestId);
      return { commands: [{ id: requestId, type: "driver_state" }], resumeResponseId: null };
    },
    sessionReference(state, current) {
      return state.sessionId
        ? { backend: "sqlite", id: state.sessionId, storagePath: "/agent/sessions.sqlite" }
        : current;
    },
  };
  const owners = [];
  const state = {
    config: { PERSISTENT_STORE: "sqlite", SQLITE_PATH: "/agent/sessions.sqlite" },
    currentDir: "/work",
    runners: new Map(),
    sseClients: new Set(),
    serverEvent() {},
    sessionReferences: createSessionReferenceCodec({
      agentDir: "/agent", jsonlRoot: "/agent/sessions", sqlitePath: "/agent/sessions.sqlite",
    }),
  };
  const manager = await createRunnerManager(state, {
    runnerDriver: driver,
    ensureSessionOwner(reference) { owners.push(reference); return null; },
  });
  t.after(async () => {
    clearInterval(state.runnerWatchdogTimer);
    clearInterval(state.runnerReaperTimer);
    await manager.stopPi();
  });

  const runner = await manager.spawnRunner({ dir: "/work" });
  assert.equal(manager.runnerDriver, driver);
  assert.equal(launched.length, 1);
  assert.equal(launched[0].cwd, "/work");
  assert.deepEqual(commands, [{ kind: "state", correlation: "_srv-1" }]);

  process.stdout.write(`${JSON.stringify({ kind: "initialized", session: "cc-session-1" })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.runnerInfo(runner).sessionId, "cc-session-1");
  assert.deepEqual(owners, [{ backend: "sqlite", id: "cc-session-1", storagePath: "/agent/sessions.sqlite" }]);

  assert.equal(await manager.sendToRunner(runner, { type: "prompt", message: "Build it" }), true);
  assert.deepEqual(commands.at(-1), { kind: "user", text: "Build it" });
  process.stdout.write(`${JSON.stringify({ kind: "started" })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.runnerInfo(runner).busy, true);
  process.stdout.write(`${JSON.stringify({ kind: "settled" })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.runnerInfo(runner).busy, false);
  assert.deepEqual(commands.at(-1), { kind: "state", correlation: "_srv-2" });
});
