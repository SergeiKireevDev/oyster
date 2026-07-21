import test from "node:test";
import assert from "node:assert/strict";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";

test("UI action registry replacement registration keeps only the current handler", () => {
  const calls = [];
  const registry = createUiActionRegistry();
  const detachFirst = registry.register("menu", (value) => calls.push(["first", value]));
  const detachSecond = registry.register("menu", (value) => calls.push(["second", value]));

  assert.equal(registry.invoke("menu", "settings"), 1);
  assert.deepEqual(calls, [["second", "settings"]]);

  detachFirst();
  registry.invoke("menu", "sessions");
  assert.deepEqual(calls.at(-1), ["second", "sessions"]);

  detachSecond();
  assert.equal(registry.invoke("menu", "unused"), undefined);
});

test("UI action registry returns undefined for missing actions", () => {
  const registry = createUiActionRegistry();
  assert.equal(registry.invoke("missing", 1, 2), undefined);
});

test("UI action registry teardown is idempotent and prevents reuse", () => {
  const registry = createUiActionRegistry();
  let calls = 0;
  registry.register("run", () => ++calls);
  registry.invoke("run");
  registry.teardown();
  registry.teardown();

  assert.equal(registry.invoke("run"), undefined);
  registry.register("run", () => ++calls);
  assert.equal(registry.invoke("run"), undefined);
  assert.equal(calls, 1);
});
