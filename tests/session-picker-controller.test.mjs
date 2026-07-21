import test from "node:test";
import assert from "node:assert/strict";
import { createSessionPickerController } from "../public/src/lib/sessionPickerController.js";
test("session picker controller stops the runner owning a session", async () => {
  const runners = [{ id: "runner", sessionFile: "/session.jsonl", alive: true }]; let stopped; let next;
  const controller = createSessionPickerController({ stopRunner: async (id) => { stopped = id; }, getRunners: () => runners, markStopped: (items, id) => items.map((item) => ({ ...item, alive: item.id !== id })), setRunners: (items) => { next = items; }, toast: () => {} });
  await controller.stopSession({ path: "/session.jsonl" });
  assert.equal(stopped, "runner"); assert.equal(next[0].alive, false);
});
