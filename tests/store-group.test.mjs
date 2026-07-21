import test from "node:test";
import assert from "node:assert/strict";
import { writable } from "svelte/store";
import { subscribeStoreGroup } from "../public/src/lib/storeGroup.js";

test("grouped tool subscriptions publish every member update without polling", () => {
  const first = writable({ status: "running", resultText: "" });
  const second = writable({ status: "running", resultText: "" });
  const snapshots = [];
  const unsubscribe = subscribeStoreGroup([first, second], (values) => snapshots.push(values));

  first.update((card) => ({ ...card, resultText: "partial" }));
  second.update((card) => ({ ...card, status: "ok", resultText: "done" }));
  first.update((card) => ({ ...card, status: "error" }));

  assert.deepEqual(snapshots.at(-3).map((card) => [card.status, card.resultText]), [
    ["running", "partial"], ["running", ""],
  ]);
  assert.deepEqual(snapshots.at(-2).map((card) => [card.status, card.resultText]), [
    ["running", "partial"], ["ok", "done"],
  ]);
  assert.deepEqual(snapshots.at(-1).map((card) => card.status), ["error", "ok"]);

  const count = snapshots.length;
  unsubscribe();
  first.set({ status: "ok", resultText: "late" });
  assert.equal(snapshots.length, count);
});
