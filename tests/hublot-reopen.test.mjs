import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { reserveHublot, recordHublotTransition, reopenHublot } from "../server/tunnels.mjs";
import { createPinnedWidgetRuntime } from "../public/src/features/pinned-widgets/createPinnedWidgetRuntime.js";
import { createTunnelRoutes } from "../server/http/routes/tunnelRoutes.mjs";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-reopen-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  const events = [];
  const state = { appStore: store, currentDir: root, config: { PI_AGENT_DIR: root }, serverEvent: (e) => events.push(e) };
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const row = await reserveHublot(state, { port: 49761, brief: "preview" });
  await recordHublotTransition(state, row.id, "closed", { desiredState: "closed" });
  return { state, row, events, store };
}

test("reopen preserves identity and starts only the tunnel", async (t) => {
  const { state, row, events, store } = await fixture(t);
  const order = [];
  const result = await reopenHublot(state, row.id, {
    open: async (_state, options) => { order.push("tunnel"); assert.equal(options.id, row.id); return { id: row.id, url: "https://new.test" }; },
  });
  assert.deepEqual(order, ["tunnel"]);
  assert.equal(result.id, row.id);
  assert.equal(events[0].type, "tunnel_opening");
  assert.equal((await store.repositories.hublots.find(row.id)).desired_state, "open");
});

test("failed tunnel startup leaves the hublot retryable", async (t) => {
  const { state, row, store, events } = await fixture(t);
  await assert.rejects(reopenHublot(state, row.id, {
    open() { throw new Error("startup failed"); },
  }), /startup failed/);
  assert.equal((await store.repositories.hublots.find(row.id)).status, "failed");
  assert.equal(state.hublotReopens.size, 0);
  assert.equal(events.at(-1).type, "hublot_failed");
});

test("concurrent reopens are rejected", async (t) => {
  const { state, row } = await fixture(t);
  state.hublotReopens = new Set([row.id]);
  await assert.rejects(reopenHublot(state, row.id), (e) => e.statusCode === 409);
});

test("reopen route validates ids and preserves lifecycle errors", async () => {
  const routes = createTunnelRoutes({ state: {}, config: {}, requestContext: {
    readJsonBody: async (req) => req.body,
    json: (res, status, body) => Object.assign(res, { status, body }),
  }, reopenHublot: async () => { throw Object.assign(new Error("no such hublot"), { statusCode: 404 }); } });
  for (const [body, status] of [[{}, 400], [{ id: "missing" }, 404]]) {
    const res = {};
    await routes["POST /tunnels/reopen"]({ body }, res);
    assert.equal(res.status, status);
  }
});

for (const confirmed of [false, true]) test(`dead widget confirmation: ${confirmed}`, async () => {
  const calls = [];
  const runtime = createPinnedWidgetRuntime({
    getSessionId: () => null, load: async () => {}, toast() {},
    dialogs: { openConfirm: async (title) => { assert.equal(title, "reopen hublot?"); return confirmed; } },
    fetchImpl: async (url, options) => { calls.push([url, JSON.parse(options.body)]); return { ok: true, json: async () => ({}) }; },
  });
  await runtime.actions.open({ kind: "live_interface", hublotId: "h1", label: "Preview", availability: "closed" });
  assert.deepEqual(calls, confirmed ? [["/tunnels/reopen", { id: "h1" }]] : []);
});


for (const kind of ["self_served", "agent_managed"]) test(`${kind} records reopen only the tunnel without running stored scripts`, async (t) => {
  const { state, row, store } = await fixture(t);
  await store.repositories.hublots.update(row.id, {
    service_kind: kind, service_start_script: "#!/bin/sh\nexit 1", service_start_script_path: "/missing/legacy.sh", service_start_script_sha256: "legacy",
  });
  const result = await reopenHublot(state, row.id, {
    materialize: () => assert.fail("must not materialize a script"),
    spawnProcess: () => assert.fail("must not start a service"),
    waitForPort: () => assert.fail("must not provision a port"),
    open: async (_state, options) => {
      assert.equal(options.port, row.port);
      assert.equal((await store.repositories.hublots.find(row.id)).status, "opening");
      return { id: row.id, url: "https://fresh.test" };
    },
  });
  assert.equal(result.id, row.id);
});
