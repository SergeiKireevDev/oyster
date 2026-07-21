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
});
