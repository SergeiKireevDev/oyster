import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
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

function setup(t) {
  const spawns = [];
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
  const manager = createRunnerManager(state, {
    spawnImpl(bin, args, options) {
      const proc = fakeProcess();
      spawns.push({ bin, args, options, proc });
      return proc;
    },
  });
  t.after(() => {
    clearInterval(state.runnerWatchdogTimer);
    clearInterval(state.runnerReaperTimer);
    manager.stopPi();
  });
  return { manager, sessionReferences, spawns, state, sqlitePath };
}

test("SQLite runners start and restart by ID with explicit store environment", (t) => {
  const { manager, spawns, sqlitePath } = setup(t);
  const sessionRef = { backend: "sqlite", id: "sqlite-one", storagePath: sqlitePath };
  const runner = manager.spawnRunner({ dir: "/workspace", sessionRef });

  assert.deepEqual(spawns[0].args, ["--mode", "rpc", "--session", "sqlite-one", "--thinking", "off"]);
  assert.equal(spawns[0].options.env.PERSISTENT_STORE, "sqlite");
  assert.equal(runner.resumeId, undefined);
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

test("runner deduplication compares the full reference, not the shared SQLite path", (t) => {
  const { manager, sqlitePath, state } = setup(t);
  const firstRef = { backend: "sqlite", id: "first", storagePath: sqlitePath };
  const secondRef = { backend: "sqlite", id: "second", storagePath: sqlitePath };
  const first = manager.openSessionRunner({ sessionRef: firstRef, dir: "/workspace" });
  assert.equal(manager.openSessionRunner({ sessionRef: { ...firstRef } }), first);
  const second = manager.openSessionRunner({ sessionRef: secondRef, dir: "/workspace" });
  assert.notEqual(second, first);
  assert.equal(state.runners.size, 2);
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
});
