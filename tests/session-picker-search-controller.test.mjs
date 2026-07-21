import test from "node:test";
import assert from "node:assert/strict";
import { createSessionPickerSearchController } from "../public/src/lib/sessionPickerSearchController.js";
test("session picker search ignores stale results", async () => {
  let snapshot = { query: "term", scope: "all", sessions: [], excludeTools: true };
  const updates = [];
  const controller = createSessionPickerSearchController({ getSnapshot: () => snapshot, update: (value) => updates.push(value), groupResults: (items) => items, fetchSearch: async () => { snapshot = { ...snapshot, query: "new" }; return { ok: true, status: 200, data: { results: [1], filesSearched: 1 } }; } });
  await controller.search();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].searching, true);
});
