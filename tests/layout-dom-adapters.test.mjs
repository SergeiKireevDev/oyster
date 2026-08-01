import test from "node:test";
import assert from "node:assert/strict";
import { createLayoutDomAdapters } from "../public/src/platform/createLayoutDomAdapters.js";

test("layout DOM adapters isolate feature element inspection", () => {
  const sessions = {};
  const hublots = {};
  const adapters = createLayoutDomAdapters({
    documentTarget: {}, windowTarget: {},
    findElement: (id) => ({ sessions, hublots })[id],
  });
  assert.equal(adapters.isTreeOpen(), false);
  assert.equal(adapters.sessions, sessions);
  assert.equal(adapters.hublots, hublots);
  assert.equal(adapters.isDrawerToggleTarget({ closest: () => ({}) }), false);
  assert.equal(adapters.isDrawerToggleTarget(null), false);
});
