import test from "node:test";
import assert from "node:assert/strict";
import { createTransportRuntime } from "../public/src/runtime/transportRuntime.js";

test("transport runtime is importable without previous construction", () => {
  assert.equal(typeof createTransportRuntime, "function");
});
