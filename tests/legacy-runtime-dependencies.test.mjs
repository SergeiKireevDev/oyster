import test from "node:test";
import assert from "node:assert/strict";
import { createLegacyRuntimeDependencies, createLegacyRuntimeLifecycleDependencies } from "../public/src/runtime/legacyRuntimeDependencies.js";

test("legacy lifecycle dependency factory preserves lifecycle callbacks", () => {
  const dependencies = {
    attachAuthenticatedFetch: () => {}, attachEventAdapters: () => {}, attachDebugHooks: () => {},
    start: () => {}, teardown: () => {},
  };
  assert.deepEqual(createLegacyRuntimeLifecycleDependencies(dependencies), createLegacyRuntimeDependencies(dependencies));
});
