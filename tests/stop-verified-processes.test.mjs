import test from "node:test";
import assert from "node:assert/strict";
import { stopVerifiedProcesses } from "../server/tunnels.mjs";

function fixture(targets, onSignal = () => {}) {
  let now = 0;
  const alive = new Set(targets.map((row) => row.pid));
  const signals = [], sleeps = [];
  const options = {
    termTimeoutMs: 60, killTimeoutMs: 30, pollIntervalMs: 25,
    verifyIdentity: (row) => alive.has(row.pid),
    signalProcess(pid, signal) { signals.push([pid, signal]); onSignal(pid, signal, alive); },
    clock: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
  };
  return { alive, signals, sleeps, options };
}
const targets = [{ id: "a", pid: 100 }, { id: "b", pid: 101 }];

test("verified shutdown skips dead identities and finishes immediately after TERM", async () => {
  const f = fixture(targets, (pid, _signal, alive) => alive.delete(pid));
  f.alive.delete(101);
  assert.deepEqual(await stopVerifiedProcesses(targets, f.options), { remaining: [], escalated: 0 });
  assert.deepEqual(f.signals, [[100, "SIGTERM"]]);
  assert.deepEqual(f.sleeps, []);
});

test("verified shutdown escalates only survivors and bounds its final poll sleep", async () => {
  const f = fixture(targets, (pid, signal, alive) => {
    if (pid === 100 || signal === "SIGKILL") alive.delete(pid);
  });
  assert.deepEqual(await stopVerifiedProcesses(targets, f.options), { remaining: [], escalated: 1 });
  assert.deepEqual(f.signals, [[100, "SIGTERM"], [101, "SIGTERM"], [101, "SIGKILL"]]);
  assert.deepEqual(f.sleeps, [25, 25, 10]);
});

test("verified shutdown returns survivors after both bounded deadlines", async () => {
  const f = fixture(targets);
  assert.deepEqual(await stopVerifiedProcesses(targets, f.options), { remaining: targets, escalated: 2 });
  assert.deepEqual(f.sleeps, [25, 25, 10, 25, 5]);
});

test("verified shutdown rechecks identity during polling before KILL (PID reuse)", async () => {
  const f = fixture(targets);
  const sleep = f.options.sleep;
  f.options.sleep = async (ms) => { await sleep(ms); f.alive.clear(); };
  assert.deepEqual(await stopVerifiedProcesses(targets, f.options), { remaining: [], escalated: 0 });
  assert.deepEqual(f.signals, [[100, "SIGTERM"], [101, "SIGTERM"]]);
  assert.deepEqual(f.sleeps, [25]);
});

test("verified shutdown ignores ESRCH but propagates other signalling errors", async () => {
  const f = fixture(targets, (pid, _signal, alive) => {
    alive.delete(pid);
    throw Object.assign(new Error("gone"), { code: "ESRCH" });
  });
  assert.deepEqual(await stopVerifiedProcesses(targets, f.options), { remaining: [], escalated: 0 });
  const error = Object.assign(new Error("not permitted"), { code: "EPERM" });
  const denied = fixture(targets, () => { throw error; });
  await assert.rejects(stopVerifiedProcesses(targets, denied.options), (actual) => actual === error);
  assert.deepEqual(denied.sleeps, []);
});

test("verified shutdown handles empty targets and zero timeouts", async () => {
  const empty = fixture([]);
  assert.deepEqual(await stopVerifiedProcesses([], empty.options), { remaining: [], escalated: 0 });
  assert.deepEqual(empty.signals, []);
  assert.deepEqual(empty.sleeps, []);
  const f = fixture(targets);
  assert.deepEqual(await stopVerifiedProcesses(targets, { ...f.options, termTimeoutMs: 0, killTimeoutMs: 0 }), { remaining: targets, escalated: 2 });
  assert.deepEqual(f.sleeps, []);
});
