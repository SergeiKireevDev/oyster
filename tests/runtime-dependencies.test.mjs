import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeDependencies, createRuntimeLifecycleDependencies } from "../public/src/runtime/runtimeDependencies.js";

test("runtime lifecycle dependency factory preserves lifecycle callbacks", () => {
  const dependencies = {
    attachAuthenticatedFetch: () => {}, attachEventAdapters: () => {}, attachDebugHooks: () => {},
    start: () => {}, teardown: () => {},
  };
  assert.deepEqual(createRuntimeLifecycleDependencies(dependencies), createRuntimeDependencies(dependencies));
});
