import test from "node:test";
import assert from "node:assert/strict";
import { createHublotController } from "../public/src/lib/hublotController.js";
import { listHublots } from "../public/src/lib/hublotActions.js";
test("hublot listing requests the Hub-wide collection before applying session visibility", async () => {
  let requested;
  const tunnels = await listHublots(async (url) => {
    requested = url;
    return { ok: true, async json() { return { tunnels: [{ id: "alpha" }, { id: "beta" }] }; } };
  }, (tunnel) => tunnel.id === "beta");
  assert.equal(requested, "/tunnels?all=1");
  assert.deepEqual(tunnels, [{ id: "beta" }]);
});

test("hublot controller binds creation to current session", async () => {
  let request; const states = [];
  const controller = createHublotController({ createHublot: async (value) => { request = value; return { tunnel: { url: "https://x" } }; }, getSessionId: () => "session", setDescription: (value) => states.push(value), setCreating: () => {}, close: () => {}, toast: () => {} });
  await controller.create(" demo ");
  assert.deepEqual(request, { label: "demo", sessionId: "session", brief: "demo" });
  assert.deepEqual(states, [" demo ", ""]);
});
test("hublot controller refreshes the sidebar best-effort when authenticated", async () => {
  const calls = [];
  const controller = createHublotController({
    isAuthenticated: () => true,
    listSidebarHublots: async () => [{ id: 1 }],
    setSidebarLoading: (value) => calls.push(["loading", value]),
    setSidebarTunnels: (value) => calls.push(["tunnels", value]),
  });
  await controller.refreshSidebar();
  assert.deepEqual(calls, [["loading", true], ["tunnels", [{ id: 1 }]], ["loading", false]]);
});

test("hublot controller exposes pinned-widget load failures for retry", async () => {
  const calls = [];
  const controller = createHublotController({
    isAuthenticated: () => true,
    listSidebarHublots: async () => { throw new Error("offline"); },
    setSidebarLoading: (value) => calls.push(["loading", value]),
    setSidebarError: (value) => calls.push(["error", value]),
    setSidebarTunnels: (value) => calls.push(["widgets", value]),
  });

  await controller.refreshSidebar();

  assert.deepEqual(calls, [
    ["loading", true], ["error", ""], ["widgets", []], ["error", "offline"], ["loading", false],
  ]);
});

test("hublot controller ignores stale overlapping sidebar refreshes", async () => {
  const pending = [];
  const rendered = [];
  let sessionId = "previous-session";
  const controller = createHublotController({
    isAuthenticated: () => true,
    getSessionId: () => sessionId,
    listSidebarHublots: (requestedSessionId) => new Promise((resolve) => pending.push({ requestedSessionId, resolve })),
    setSidebarLoading: () => {},
    setSidebarTunnels: (value) => rendered.push(value),
  });

  const staleRefresh = controller.refreshSidebar();
  sessionId = "current-session";
  const currentRefresh = controller.refreshSidebar();
  assert.deepEqual(pending.map((request) => request.requestedSessionId), ["previous-session", "current-session"]);
  pending[1].resolve([{ id: "current-session" }]);
  await currentRefresh;
  pending[0].resolve([{ id: "previous-session" }]);
  await staleRefresh;

  assert.deepEqual(rendered, [[{ id: "current-session" }]]);
});

test("hublot controller applies widget groups atomically after its stale-response guard", async () => {
  const pending = [];
  const rendered = [];
  const controller = createHublotController({
    isAuthenticated: () => true,
    listSidebarHublots: () => new Promise((resolve) => pending.push(resolve)),
    setSidebarLoading: () => {},
    setSidebarTunnels: () => assert.fail("collection setter should own widgets and groups"),
    setSidebarCollection: (value) => rendered.push(value),
  });

  const staleRefresh = controller.refreshSidebar();
  const currentRefresh = controller.refreshSidebar();
  const current = { widgets: [{ id: "current" }], groups: [{ id: "current-group" }] };
  const stale = { widgets: [{ id: "stale" }], groups: [{ id: "stale-group" }] };
  pending[1](current);
  await currentRefresh;
  pending[0](stale);
  await staleRefresh;

  assert.deepEqual(rendered, [current]);
});

test("hublot controller refreshes filtered manager state", async () => {
  const updates = [];
  const controller = createHublotController({ getSessionId: () => "s", getScopeAll: () => false, getDescription: () => "", listHublots: async () => [{ id: 1 }, { id: 2 }], isVisible: (tunnel) => tunnel.id === 1, updateManager: (value) => updates.push(value), toast: () => {} });
  await controller.refresh({ loading: true });
  assert.equal(updates[1].total, 2);
  assert.deepEqual(updates[1].tunnels, [{ id: 1 }]);
});
