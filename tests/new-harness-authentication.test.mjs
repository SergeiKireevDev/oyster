import test from "node:test";
import assert from "node:assert/strict";
import { createNewHarnessAuthenticationCheck, hasAuthenticatedProvider } from "../public/src/lib/newHarnessAuthentication.js";
import { createSessionRuntime } from "../public/src/runtime/sessionRuntime.js";

for (const harness of ["pi", "claude-code", "codex", "gemini", "amp"]) {
  test(`new ${harness} sessions prompt only when no compatible provider is authenticated`, async () => {
    const opened = [];
    let providers = [];
    const check = createNewHarnessAuthenticationCheck({
      fetchImpl: async (path) => { assert.equal(path, "/api-keys"); return { ok: true, json: async () => ({ providers }) }; },
      getCurrentRunner: () => "new", openCredentials: (target) => opened.push(target),
      toast: () => assert.fail("unexpected error"),
    });
    await check({ id: "new", harness });
    assert.deepEqual(opened, [{ harness }]);
    providers = [{ harness, configured: true, credentialType: "oauth" }];
    await check({ id: "new", harness });
    assert.equal(opened.length, 1);
  });
}

test("shared OAuth grants authenticate native harnesses but unrelated API keys do not", () => {
  const row = { configured: true, harnesses: ["pi", "codex"], credentialType: "oauth" };
  assert.equal(hasAuthenticatedProvider([row], "codex"), true);
  assert.equal(hasAuthenticatedProvider([row], "gemini"), false);
  assert.equal(hasAuthenticatedProvider([{ ...row, credentialType: "api_key" }], "codex"), false);
  assert.equal(hasAuthenticatedProvider([{ ...row, credentialType: null }], "codex"), false);
  assert.equal(hasAuthenticatedProvider([{ ...row, credentialType: "api_key" }], "pi"), true);
  assert.equal(hasAuthenticatedProvider([{ ...row, configured: false }], "codex"), false);
});

test("an authentication check cannot open a modal after switching away", async () => {
  let current = "new";
  const check = createNewHarnessAuthenticationCheck({
    fetchImpl: async () => { current = "other"; return { ok: true, json: async () => ({ providers: [] }) }; },
    getCurrentRunner: () => current,
    openCredentials: () => assert.fail("stale authentication modal"), toast: () => assert.fail("unexpected error"),
  });
  await check({ id: "new", harness: "codex" });
});

test("credential lookup failures do not incorrectly initiate authentication", async () => {
  const errors = [];
  const check = createNewHarnessAuthenticationCheck({
    fetchImpl: async () => ({ ok: false, status: 503 }), getCurrentRunner: () => "new",
    openCredentials: () => assert.fail("failed lookup is not proof of missing credentials"),
    toast: (message) => errors.push(message),
  });
  await check({ id: "new", harness: "amp" });
  assert.match(errors[0], /503/);
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
