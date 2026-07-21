import test from "node:test";
import assert from "node:assert/strict";
import { createRpcClient } from "../public/src/runtime/rpcClient.js";

test("rpc client disposal rejects pending commands and clears their timers", async () => {
  const originalFetch = globalThis.fetch;
  const timers = [];
  const cleared = [];
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  try {
    const client = createRpcClient({
      getRunner: () => "runner", getToken: () => "token", onUnauthorized: () => {}, onPendingResume: () => {},
      setTimeoutImpl: (callback) => { const timer = { callback }; timers.push(timer); return timer; },
      clearTimeoutImpl: (timer) => cleared.push(timer),
    });
    const pending = client.rpc({ type: "get_state" });
    await new Promise((resolve) => setImmediate(resolve));
    client.dispose();
    await assert.rejects(pending, /rpc client stopped/);
    assert.equal(timers.length, 1);
    assert.deepEqual(cleared, timers);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
