import test from "node:test";
import assert from "node:assert/strict";
import { reportNode } from "../public/src/lib/nodeReporter.js";

test("node reporter immediately reports the node and follows callback updates", () => {
  const node = { id: "message" };
  const calls = [];
  const action = reportNode(node, (value) => calls.push(["initial", value]));

  action.update((value) => calls.push(["updated", value]));

  assert.deepEqual(calls, [
    ["initial", node],
    ["updated", node],
  ]);
});
