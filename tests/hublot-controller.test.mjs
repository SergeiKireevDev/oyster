import test from "node:test";
import assert from "node:assert/strict";
import { createHublotController } from "../public/src/lib/hublotController.js";
test("hublot controller binds creation to current session", async () => {
  let request; const states = [];
  const controller = createHublotController({ createHublot: async (value) => { request = value; return { tunnel: { url: "https://x" } }; }, getSessionId: () => "session", setDescription: (value) => states.push(value), setCreating: () => {}, close: () => {}, toast: () => {} });
  await controller.create(" demo ");
  assert.deepEqual(request, { label: "demo", sessionId: "session", brief: "demo" });
  assert.deepEqual(states, [" demo ", ""]);
});
