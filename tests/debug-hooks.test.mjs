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
  const registration = installDebugHooks(target, hooks);
  assert.deepEqual(target, hooks);
  registration.detach();
  assert.deepEqual(target, {});
});

test("debug hook adapter restores existing hooks on detach", () => {
  const originalRpc = () => {};
  const target = { rpc: originalRpc };
  const registration = installDebugHooks(target, {
    rpc: () => {}, refreshState: () => {}, loadHublots: () => {}, loadRoutines: () => {},
  });
  registration.detach();
  assert.deepEqual(target, { rpc: originalRpc });
});
