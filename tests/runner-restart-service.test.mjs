import test from "node:test";
import assert from "node:assert/strict";
import { createRestartActiveRunners } from "../server/runner-restart-service.mjs";

test("active-runner restart captures live runners once and leaves inactive runners stopped", async () => {
  const activeA = { id: "a", proc: {}, resumeQueue: [{ id: "queued-a" }] };
  const inactive = { id: "inactive", proc: null, resumeQueue: [] };
  const activeB = { id: "b", proc: {}, resumeQueue: [] };
  const collection = new Map([[activeA.id, activeA], [inactive.id, inactive], [activeB.id, activeB]]);
  const calls = [];
  const restart = createRestartActiveRunners({
    runners: () => collection,
    stopRunner(runner) {
      calls.push(["stop", runner.id]);
      runner.proc = null;
      runner.resumeQueue = [];
    },
    startRunner(runner) {
      calls.push(["start", runner.id]);
      runner.proc = { replacement: true };
    },
    async delay(ms) { calls.push(["delay", ms]); },
  });

  const result = await restart();
  assert.deepEqual(calls, [
    ["stop", "a"], ["stop", "b"], ["delay", 300], ["start", "a"], ["start", "b"],
  ]);
  assert.deepEqual(result, { runnerIds: ["a", "b"], status: "restarted" });
  assert.deepEqual(activeA.resumeQueue, [{ id: "queued-a" }]);
  assert.equal(inactive.proc, null);
});

test("active-runner restart reports partial lifecycle failure without restarting other runners twice", async () => {
  const first = { id: "first", proc: {} };
  const failed = { id: "failed", proc: {} };
  const collection = new Map([[first.id, first], [failed.id, failed]]);
  const starts = [];
  const restart = createRestartActiveRunners({
    runners: () => collection,
    stopRunner(runner) { runner.proc = null; },
    startRunner(runner) {
      starts.push(runner.id);
      if (runner === failed) throw new Error("spawn failed");
      runner.proc = {};
    },
    delay: async () => {},
  });

  assert.deepEqual(await restart(), {
    runnerIds: ["first", "failed"], status: "partial", failedRunnerIds: ["failed"],
  });
  assert.deepEqual(starts, ["first", "failed"]);
});

test("runner removal during restart is reported and not resurrected", async () => {
  const runner = { id: "gone", proc: {} };
  const collection = new Map([[runner.id, runner]]);
  const restart = createRestartActiveRunners({
    runners: () => collection,
    stopRunner(item) { item.proc = null; },
    startRunner() { throw new Error("must not start"); },
    async delay() { collection.delete(runner.id); },
  });
  assert.deepEqual(await restart(), {
    runnerIds: ["gone"], status: "partial", failedRunnerIds: ["gone"],
  });
});

test("restart awaits asynchronous lifecycle operations and retains work queued while stopping", async () => {
  const beforeStop = { id: "before" };
  const duringStop = { id: "during" };
  const runner = { id: "async", proc: {}, resumeQueue: [beforeStop] };
  const events = [];
  const restart = createRestartActiveRunners({
    runners: () => new Set([runner]),
    async stopRunner(item) {
      events.push("stopping");
      item.proc = null;
      item.resumeQueue = [];
      await Promise.resolve();
      item.resumeQueue.push(duringStop);
      events.push("stopped");
    },
    async startRunner(item) {
      events.push(["starting", [...item.resumeQueue]]);
      await Promise.resolve();
      item.proc = {};
      events.push("started");
    },
    async delay() { events.push("delay"); },
  });

  assert.deepEqual(await restart(), { runnerIds: ["async"], status: "restarted" });
  assert.deepEqual(events, [
    "stopping", "stopped", "delay", ["starting", [beforeStop, duringStop]], "started",
  ]);
  assert.deepEqual(runner.resumeQueue, [beforeStop, duringStop]);
});

test("stop failures preserve queued resume work and do not produce duplicate failure IDs", async () => {
  const queued = { id: "queued" };
  const runner = { id: "failed-stop", proc: {}, resumeQueue: [queued] };
  const restart = createRestartActiveRunners({
    runners: () => [runner],
    stopRunner(item) {
      item.resumeQueue = [];
      throw new Error("stop failed after clearing queue");
    },
    startRunner() { throw new Error("must not start after a stop failure"); },
    delay: async () => {},
  });

  assert.deepEqual(await restart(), {
    runnerIds: ["failed-stop"], status: "partial", failedRunnerIds: ["failed-stop"],
  });
  assert.deepEqual(runner.resumeQueue, [queued]);
});

test("a rejected asynchronous start is reported as a partial restart", async () => {
  const runner = { id: "rejected-start", proc: {}, resumeQueue: [] };
  const restart = createRestartActiveRunners({
    runners: () => [runner],
    stopRunner(item) { item.proc = null; },
    async startRunner() { throw new Error("rejected start"); },
    delay: async () => {},
  });

  assert.deepEqual(await restart(), {
    runnerIds: ["rejected-start"], status: "partial", failedRunnerIds: ["rejected-start"],
  });
});

test("invalid restart dependencies and collections fail with clear errors", async () => {
  const lifecycle = { runners: () => [], stopRunner() {}, startRunner() {} };
  assert.throws(() => createRestartActiveRunners({ ...lifecycle, delay: null }), /delay must be a function/);
  assert.throws(() => createRestartActiveRunners({ ...lifecycle, restartDelayMs: -1 }), /non-negative finite number/);
  assert.throws(() => createRestartActiveRunners({ ...lifecycle, restartDelayMs: Number.NaN }), /non-negative finite number/);

  const restart = createRestartActiveRunners({
    ...lifecycle,
    runners: () => null,
    delay: async () => {},
  });
  await assert.rejects(restart(), /runners\(\) must return a Map or iterable/);
});
