import test from "node:test";
import assert from "node:assert/strict";
import { BASE, TOKEN, login } from "./e2e/lib/harness.js";

for (const [label, sessionId, path] of [
  ["default connection", null, "/"],
  ["saved session", "saved-session", "/s/saved-session"],
  ["encoded session identifier", "session /?#", "/s/session%20%2F%3F%23"],
]) {
  test(`E2E login opens the ${label} before waiting for the connection`, async () => {
    const calls = [];
    const page = {
      async goto(url) { calls.push(["goto", url]); },
      async waitForSelector(selector) { calls.push(["wait", selector]); },
    };
    await login(page, { sessionId, keepCredentialSetup: true });
    assert.deepEqual(calls, [
      ["goto", `${process.env.OYSTER_URL ?? BASE}${path}#token=${process.env.OYSTER_TOKEN ?? TOKEN}`],
      ["wait", "#connDot.ok"],
      ["wait", "#input"],
    ]);
  });
}
