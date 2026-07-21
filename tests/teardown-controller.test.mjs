import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeTeardown } from "../public/src/runtime/teardownController.js";

test("runtime teardown releases callbacks in order once", () => {
  const calls = [];
  const teardown = createRuntimeTeardown([() => calls.push("transport"), () => calls.push("listeners")]);
  assert.equal(teardown(), true);
  assert.equal(teardown(), false);
  assert.deepEqual(calls, ["transport", "listeners"]);
});
