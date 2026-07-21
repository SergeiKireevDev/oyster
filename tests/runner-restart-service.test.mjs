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
