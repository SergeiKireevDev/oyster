import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeStarterDependencies } from "../public/src/runtime/runtimeStarterDependencies.js";

test("runtime starter dependency assembly preserves startup callbacks", () => {
  const hasToken = () => true;
  const requireToken = () => {};
  const boot = () => {};
  assert.deepEqual(createRuntimeStarterDependencies({ hasToken, requireToken, boot }), { hasToken, requireToken, boot });
});
