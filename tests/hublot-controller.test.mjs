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
test("hublot controller refreshes filtered manager state", async () => {
  const updates = [];
  const controller = createHublotController({ getSessionId: () => "s", getScopeAll: () => false, getDescription: () => "", listHublots: async () => [{ id: 1 }, { id: 2 }], isVisible: (tunnel) => tunnel.id === 1, updateManager: (value) => updates.push(value), toast: () => {} });
  await controller.refresh({ loading: true });
  assert.equal(updates[1].total, 2);
  assert.deepEqual(updates[1].tunnels, [{ id: 1 }]);
});
