import test from "node:test";
import assert from "node:assert/strict";
import { createModalHistoryController } from "../public/src/lib/modalHistoryController.js";

function harness() {
  let subscriber;
  let open = false;
  const calls = [];
  const listeners = new Map();
  const windowTarget = {
    history: {
      state: { session: "one" },
      pushState(state) { this.state = state; calls.push(["push", state]); },
      back() { calls.push(["back"]); },
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { calls.push(["remove", type, listener === listeners.get(type)]); },
  };
  const emit = (value) => { open = value; subscriber({ open }); };
  const controller = createModalHistoryController({
    windowTarget,
    subscribe(fn) { subscriber = fn; fn({ open }); return () => calls.push(["unsubscribe"]); },
    isOpen: () => open,
    cancel() { calls.push(["cancel"]); emit(false); },
  });
  return { calls, listeners, emit, controller };
}

test("browser Back cancels an open modal without navigating twice", () => {
  const { calls, listeners, emit, controller } = harness();
  emit(true);
  assert.equal(calls[0][0], "push");
  assert.equal(calls[0][1].piModal, true);
  listeners.get("popstate")();
  assert.deepEqual(calls.map(([name]) => name), ["push", "cancel"]);
  controller.detach();
  assert.deepEqual(calls.slice(-2).map(([name]) => name), ["unsubscribe", "remove"]);
});

test("a chained modal gets a marker after the previous marker unwinds", () => {
  const { calls, listeners, emit } = harness();
  emit(true);
  emit(false);
  emit(true);
  assert.deepEqual(calls.map(([name]) => name), ["push", "back"]);
  listeners.get("popstate")();
  assert.deepEqual(calls.map(([name]) => name), ["push", "back", "push"]);
});
