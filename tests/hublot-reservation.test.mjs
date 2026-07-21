import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { reserveHublot } from "../server/tunnels.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-reservation-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = {
    appStore: store,
    config: { PI_AGENT_DIR: join(root, "agent") },
    currentDir: join(root, "workspace"),
  };
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, state };
}

test("agent-managed hublots reserve durable identity and startup path before runtime exists", (t) => {
  const { root, store, state } = fixture(t);
  const owner = store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "session-a", storagePath: "/agent.sqlite", createdAt: "owner" });

  const reserved = reserveHublot(state, {
    port: 4173, label: "preview", brief: "serve preview",
    sessionId: "session-a", ownerId: owner.id,
  });

  assert.equal(reserved.owner_id, owner.id);
  assert.equal(reserved.session_id, "session-a");
  assert.equal(reserved.status, "opening");
  assert.equal(reserved.desired_state, "open");
  assert.equal(reserved.public_url, null);
  assert.equal(reserved.service_kind, "agent_managed");
  assert.equal(reserved.service_start_script_path, join(root, "agent", "hublots", reserved.id, "start.sh"));
  assert.equal(state.tunnels, undefined, "reservation must precede creation of runtime process state");
  assert.deepEqual(store.repositories.hublots.listProcesses(reserved.id), []);
  assert.deepEqual(store.repositories.hublots.listLifecycleEvents(reserved.id).map((event) => event.status), ["opening"]);
});

test("hublot reservations default to agent-managed startup scripts", (t) => {
  const { root, store, state } = fixture(t);
  const reserved = reserveHublot(state, { port: 8081, label: "managed service" });
  assert.equal(reserved.service_kind, "agent_managed");
  assert.equal(reserved.service_start_script_path, join(root, "agent", "hublots", reserved.id, "start.sh"));
  assert.equal(store.repositories.hublots.find(reserved.id).status, "opening");
  assert.throws(() => reserveHublot(state, { port: 8081 }), /already tunneled/);
});
