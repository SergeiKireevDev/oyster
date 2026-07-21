import test from "node:test";
import assert from "node:assert/strict";
import { createHublotRuntime } from "../public/src/features/hublots/createHublotRuntime.js";

test("hublot runtime exposes feature actions", () => {
  const runtime = createHublotRuntime({
    isVisible: () => true, getSessionId: () => null, resetCarousel() {}, openModal() {},
    createController: (deps) => ({ create() {}, refresh() {}, refreshSidebar() {} }),
    setDescription() {}, listSidebarHublots: () => [], updateTitle() {}, refreshRoutines() {},
  });
  assert.equal(typeof runtime.show, "function");
  assert.equal(typeof runtime.toggleScope, "function");
  assert.equal(typeof runtime.removeHublot, "function");
});

function createRemovalRuntime(overrides = {}) {
  return createHublotRuntime({
    isVisible: () => true,
    getSessionId: () => null,
    resetCarousel() {},
    openModal() {},
    createController: () => ({ create() {}, refresh() {}, refreshSidebar() {} }),
    setDescription() {},
    listSidebarHublots: () => [],
    updateTitle() {},
    refreshRoutines() {},
    toast() {},
    ...overrides,
  });
}

test("hublot runtime removal updates sidebar and manager stores after network success", async () => {
  const calls = [];
  const runtime = createRemovalRuntime({
    deleteHublot: async (id) => calls.push(["delete", id]),
    removeSidebarHublot: (id) => calls.push(["sidebar", id]),
    removeManagerHublot: (id) => calls.push(["manager", id]),
    toast: (...args) => calls.push(["toast", ...args]),
  });

  await runtime.removeHublot("tunnel/id");

  assert.deepEqual(calls, [
    ["delete", "tunnel/id"],
    ["sidebar", "tunnel/id"],
    ["manager", "tunnel/id"],
  ]);
});

test("hublot runtime removal preserves stores and reports network failures", async () => {
  const calls = [];
  const runtime = createRemovalRuntime({
    deleteHublot: async () => { throw new Error("already closed"); },
    removeSidebarHublot: () => calls.push(["sidebar"]),
    removeManagerHublot: () => calls.push(["manager"]),
    toast: (...args) => calls.push(["toast", ...args]),
  });

  await runtime.removeHublot("missing");

  assert.deepEqual(calls, [["toast", "close hublot failed: already closed", "error"]]);
});
