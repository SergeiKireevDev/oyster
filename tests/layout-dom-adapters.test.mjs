import test from "node:test";
import assert from "node:assert/strict";
import { createLayoutDomAdapters } from "../public/src/platform/createLayoutDomAdapters.js";

test("layout DOM adapters isolate feature element inspection", () => {
  const treebar = { classList: { contains: (name) => name === "open" } };
  const sessions = {};
  const hublots = {};
  const adapters = createLayoutDomAdapters({
    documentTarget: {}, windowTarget: {},
    findElement: (id) => ({ sessions, treebar, hublots })[id],
  });
  assert.equal(adapters.isTreeOpen(), true);
  assert.equal(adapters.sessions, sessions);
  assert.equal(adapters.hublots, hublots);
  assert.equal(adapters.isDrawerToggleTarget({ closest: (selector) => selector === "#treeChip" ? {} : null }), true);
  assert.equal(adapters.isDrawerToggleTarget(null), false);
});
