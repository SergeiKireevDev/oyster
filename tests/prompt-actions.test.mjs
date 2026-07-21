import test from "node:test";
import assert from "node:assert/strict";
import { promptCommand } from "../public/src/lib/promptActions.js";
test("prompt commands preserve steering behavior while busy", () => {
  assert.deepEqual(promptCommand("hello", false), { type: "prompt", message: "hello" });
  assert.deepEqual(promptCommand("hello", true), { type: "prompt", message: "hello", streamingBehavior: "steer" });
});
