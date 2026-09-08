import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { reserveHublot } from "../server/tunnels.mjs";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-hublot-reservation-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = {
    appStore: store,
    config: { PI_AGENT_DIR: join(root, "agent") },
    currentDir: join(root, "workspace"),
  };
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, state };
}

test("hublots reserve durable identity without a service startup path", async (t) => {
  const { root, store, state } = await fixture(t);
  const owner = await store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "session-a", storagePath: "/agent.sqlite", createdAt: "owner" });

  const reserved = await reserveHublot(state, {
    port: 4173, label: "preview", brief: "serve preview",
    sessionId: "session-a", ownerId: owner.id,
  });

  assert.equal(reserved.owner_id, owner.id);
  assert.equal(reserved.session_id, "session-a");
  assert.equal(reserved.status, "opening");
  assert.equal(reserved.desired_state, "open");
  assert.equal(reserved.public_url, null);
  assert.equal(reserved.service_kind, "self_served");
  assert.equal(reserved.service_start_script_path, null);
  assert.equal(state.tunnels, undefined, "reservation must precede creation of runtime process state");
  assert.deepEqual(await store.repositories.hublots.listProcesses(reserved.id), []);
  assert.deepEqual((await store.repositories.hublots.listLifecycleEvents(reserved.id)).map((event) => event.status), ["opening"]);
});

test("hublot reservations never provision startup scripts", async (t) => {
  const { root, store, state } = await fixture(t);
  const reserved = await reserveHublot(state, { port: 8081, label: "managed service" });
  assert.equal(reserved.service_kind, "self_served");
  assert.equal(reserved.service_start_script_path, null);
  assert.equal((await store.repositories.hublots.find(reserved.id)).status, "opening");
  await assert.rejects(async () => await reserveHublot(state, { port: 8081 }), /already tunneled/);
});
