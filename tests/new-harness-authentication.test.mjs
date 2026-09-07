import test from "node:test";
import assert from "node:assert/strict";
import { createNewHarnessAuthenticationCheck } from "../public/src/lib/newHarnessAuthentication.js";
import { createSessionRuntime } from "../public/src/runtime/sessionRuntime.js";

for (const harness of ["claude-code", "codex", "gemini", "amp"]) {
  test(`new ${harness} session opens compatible credentials only when no models are available`, async () => {
    const opened = [];
    let models = [];
    const check = createNewHarnessAuthenticationCheck({
      rpc: async (command) => { assert.equal(command.type, "get_available_models"); return { models }; },
      getCurrentRunner: () => "new", openCredentials: (target) => opened.push(target),
      toast: () => assert.fail("unexpected error"),
    });
    await check({ id: "new", harness });
    assert.deepEqual(opened, [{ harness }]);
    models = [{ id: "available" }];
    await check({ id: "new", harness });
    assert.equal(opened.length, 1);
  });
}

test("an authentication check cannot open a modal after switching away", async () => {
  let current = "new";
  const check = createNewHarnessAuthenticationCheck({
    rpc: async () => { current = "other"; return { models: [] }; }, getCurrentRunner: () => current,
    openCredentials: () => assert.fail("stale authentication modal"), toast: () => assert.fail("unexpected error"),
  });
  await check({ id: "new", harness: "codex" });
});

test("session creation checks authentication after switching, but opening saved sessions does not", async () => {
  let current = "old";
  const checked = [];
  const runtime = createSessionRuntime({
    getCurrentRunner: () => current,
    openSession: async () => ({ id: "new", harness: "gemini" }),
    switchSessionRunner: ({ id }) => { current = id; },
    onNewSession: (runner) => { assert.equal(current, runner.id); checked.push(runner.harness); },
  });
  await runtime.openAndSwitchSession({ dir: "/work", harness: "gemini" });
  await runtime.openAndSwitchSession({ sessionKey: "saved" });
  assert.deepEqual(checked, ["gemini"]);
});
