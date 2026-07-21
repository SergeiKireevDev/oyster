import test from "node:test";
import assert from "node:assert/strict";
import { createLifecycleLogger } from "../public/src/runtime/lifecycleLogger.js";

test("lifecycle logger records elapsed time and a current state snapshot", () => {
  let now = 100;
  const calls = [];
  const lifecycleLog = createLifecycleLogger({
    now: () => now,
    log: (...args) => calls.push(args),
    snapshot: () => ({ runner: "r1" }),
  });
  now = 123.6;
  lifecycleLog("connected", { replaying: false });
  assert.deepEqual(calls, [["[pi-ui lifecycle +24ms] connected", { runner: "r1", replaying: false }]]);
});
