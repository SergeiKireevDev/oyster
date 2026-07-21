import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { recordHublotTransition, reserveHublot } from "../tunnels.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-lifecycle-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root };
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, state };
}

test("every hublot lifecycle state is durably recorded in sequence", (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4190 });
  recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://one.test", openedAt: "opened", at: "event-open" });
  recordHublotTransition(state, hublot.id, "recovering", { publicUrl: null, at: "event-recovering" });
  recordHublotTransition(state, hublot.id, "interrupted", { lastError: "process disappeared", at: "event-interrupted" });
  recordHublotTransition(state, hublot.id, "recovering", { lastError: null, at: "event-retrying" });
  recordHublotTransition(state, hublot.id, "failed", { lastError: "restart failed", at: "event-failed" });
  recordHublotTransition(state, hublot.id, "closing", { desiredState: "closed", publicUrl: null, lastError: null, at: "event-closing" });
  const final = recordHublotTransition(state, hublot.id, "closed", { desiredState: "closed", closedAt: "closed", at: "event-closed" });

  assert.equal(final.status, "closed");
  assert.equal(final.desired_state, "closed");
  assert.equal(final.public_url, null);
  assert.equal(final.closed_at, "closed");
  const events = store.repositories.hublots.listLifecycleEvents(hublot.id);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(new Set(events.map((event) => event.status)), new Set([
    "opening", "open", "recovering", "interrupted", "failed", "closing", "closed",
  ]));
  assert.equal(events.find((event) => event.status === "open").public_url, "https://one.test");
  assert.equal(events.find((event) => event.status === "interrupted").error, "process disappeared");
});

test("state and lifecycle history transition atomically", (t) => {
  const { store, state } = fixture(t);
  const hublot = reserveHublot(state, { port: 4191 });
  assert.throws(
    () => recordHublotTransition(state, hublot.id, "open", { desiredState: "invalid", publicUrl: "https://invalid.test" }),
    /constraint/i,
  );
  assert.equal(store.repositories.hublots.find(hublot.id).status, "opening");
  assert.equal(store.repositories.hublots.find(hublot.id).public_url, null);
  assert.deepEqual(store.repositories.hublots.listLifecycleEvents(hublot.id).map((event) => event.status), ["opening"]);
  assert.throws(() => recordHublotTransition(state, hublot.id, "unknown"), /invalid hublot status/);
});
