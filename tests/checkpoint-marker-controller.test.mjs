import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointMarkerController } from "../public/src/lib/checkpointMarkerController.js";

test("checkpoint marker controller aligns restores with rendered transcript entries", async () => {
  const elements = [{ id: "first" }, { id: "last" }];
  let restores;
  const controller = createCheckpointMarkerController({
    tick: async () => {}, chatElements: () => elements, setTarget: () => {}, setRestores: (value) => { restores = value; },
    fetchImpl: async () => ({ ok: true, json: async () => ({ checkpoints: [{ anchorId: "two", hash: "abc" }] }) }),
    getSessionId: () => "session", fetchSessionEntries: async () => [{ id: "one" }, { id: "two" }],
  });
  await controller.refresh();
  assert.deepEqual(restores, [{ target: elements[1], checkpoint: { anchorId: "two", hash: "abc", sessionId: "session" }, busy: false }]);
});

test("checkpoint marker controller places the target after Svelte flush", async () => {
  let target;
  const controller = createCheckpointMarkerController({ tick: async () => {}, chatElements: () => ["latest"], setTarget: (value) => { target = value; }, setRestores: () => {}, fetchImpl: null, getSessionId: () => null, fetchSessionEntries: null });
  controller.place();
  await Promise.resolve();
  assert.equal(target, "latest");
});
