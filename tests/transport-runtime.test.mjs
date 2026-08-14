import test from "node:test";
import assert from "node:assert/strict";
import { createTransportRuntime } from "../public/src/runtime/transportRuntime.js";

test("transport runtime is importable without previous construction", () => {
  assert.equal(typeof createTransportRuntime, "function");
});

function transportWithAuthReport(report) {
  const removed = [];
  const document = { cookie: "", getElementById: () => ({ focus() {} }) };
  let invalidations = 0;
  const runtime = createTransportRuntime({
    browser: {
      location: { hash: "", search: "" },
      history: { replaceState() {} },
      storage: {
        getItem: () => "saved-token",
        setItem() {},
        removeItem: (key) => removed.push(key),
      },
      document,
      fetch: async () => ({ ok: true, json: async () => report }),
    },
    gate: { classList: { add() {} } },
    getRunner: () => null,
    onInvalidToken: () => { invalidations += 1; },
    toast() {},
  });
  return { runtime, removed, document, invalidations: () => invalidations };
}

test("transport runtime accepts a saved token only after the server validates it", async () => {
  const { runtime, removed, invalidations } = transportWithAuthReport({ authorized: true });
  assert.equal(await runtime.validateToken(), true);
  assert.deepEqual(removed, []);
  assert.equal(invalidations(), 0);
});

test("transport runtime clears a saved token rejected by the server", async () => {
  const { runtime, removed, document, invalidations } = transportWithAuthReport({ authorized: false });
  assert.equal(await runtime.validateToken(), false);
  assert.deepEqual(removed, ["oyster_token"]);
  assert.match(document.cookie, /max-age=0/);
  assert.equal(invalidations(), 1);
});
