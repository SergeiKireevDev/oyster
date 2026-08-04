import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { recordHublotTransition, reserveHublot } from "../server/tunnels.mjs";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-hublot-lifecycle-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root };
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, state };
}

test("every hublot lifecycle state is durably recorded in sequence", async (t) => {
  const { store, state } = await fixture(t);
  const hublot = await reserveHublot(state, { port: 4190 });
  await recordHublotTransition(state, hublot.id, "open", { publicUrl: "https://one.test", openedAt: "opened", at: "event-open" });
  await recordHublotTransition(state, hublot.id, "recovering", { publicUrl: null, at: "event-recovering" });
  await recordHublotTransition(state, hublot.id, "interrupted", { lastError: "process disappeared", at: "event-interrupted" });
  await recordHublotTransition(state, hublot.id, "recovering", { lastError: null, at: "event-retrying" });
  await recordHublotTransition(state, hublot.id, "failed", { lastError: "restart failed", at: "event-failed" });
  await recordHublotTransition(state, hublot.id, "closing", { desiredState: "closed", publicUrl: null, lastError: null, at: "event-closing" });
  const final = await recordHublotTransition(state, hublot.id, "closed", { desiredState: "closed", closedAt: "closed", at: "event-closed" });

  assert.equal(final.status, "closed");
  assert.equal(final.desired_state, "closed");
  assert.equal(final.public_url, null);
  assert.equal(final.closed_at, "closed");
  const events = await store.repositories.hublots.listLifecycleEvents(hublot.id);
  assert.deepEqual(await events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(new Set(await events.map((event) => event.status)), new Set([
    "opening", "open", "recovering", "interrupted", "failed", "closing", "closed",
  ]));
  assert.equal((await events.find((event) => event.status === "open")).public_url, "https://one.test");
  assert.equal((await events.find((event) => event.status === "interrupted")).error, "process disappeared");
});

test("state and lifecycle history transition atomically", async (t) => {
  const { store, state } = await fixture(t);
  const hublot = await reserveHublot(state, { port: 4191 });
  await assert.rejects(
    async () => await recordHublotTransition(state, hublot.id, "open", { desiredState: "invalid", publicUrl: "https://invalid.test" }),
    /constraint/i,
  );
  assert.equal((await store.repositories.hublots.find(hublot.id)).status, "opening");
  assert.equal((await store.repositories.hublots.find(hublot.id)).public_url, null);
  assert.deepEqual((await store.repositories.hublots.listLifecycleEvents(hublot.id)).map((event) => event.status), ["opening"]);
  await assert.rejects(async () => await recordHublotTransition(state, hublot.id, "unknown"), /invalid hublot status/);
});
