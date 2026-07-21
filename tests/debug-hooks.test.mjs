import test from "node:test";
import assert from "node:assert/strict";
import { installDebugHooks } from "../public/src/runtime/debugHooks.js";

test("debug hook adapter publishes the integration hooks", () => {
  const target = {};
  const hooks = {
    rpc: () => {},
    refreshState: () => {},
    loadHublots: () => {},
    loadRoutines: () => {},
  };
  installDebugHooks(target, hooks);
  assert.deepEqual(target, hooks);
});
