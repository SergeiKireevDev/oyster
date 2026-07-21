import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clearAuthToken, createUnauthorizedHandler, installAuthenticatedFetch, showAuthGate } from "../public/src/runtime/authClient.js";
import { AUTH_TOKEN_KEY, createAuthBrowserService } from "../public/src/runtime/authBrowserService.js";

test("authenticated fetch adapter restores the original fetch on detach", async () => {
  const calls = [];
  const originalFetch = async (...args) => { calls.push(args); return "ok"; };
  const target = { fetch: originalFetch };
  const registration = installAuthenticatedFetch("token", { windowTarget: target });
  assert.equal(await target.fetch("/api", { headers: { existing: "value" } }), "ok");
  assert.deepEqual(calls, [["/api", { headers: { "x-auth-token": "token", existing: "value" } }]]);
  registration.detach();
  assert.equal(target.fetch, originalFetch);
});

test("clearAuthToken removes storage and expires the cookie", () => {
  let removed; const documentTarget = {};
  clearAuthToken({ storage: { removeItem: (key) => { removed = key; } }, documentTarget });
  assert.equal(removed, "pi_ui_token");
  assert.match(documentTarget.cookie, /max-age=0/);
});

test("showAuthGate opens and focuses the authentication controls", () => {
  let opened = false; let focused = false;
  showAuthGate({ gate: { classList: { add: (name) => { opened = name === "open"; } } }, input: { focus: () => { focused = true; } } });
  assert.equal(opened, true);
  assert.equal(focused, true);
});

test("unauthorized handler clears auth only after a confirmed 401", async () => {
  let removed; let opened = 0;
  const handler = createUnauthorizedHandler({
    fetchImpl: async () => ({ status: 401 }),
    storage: { removeItem: (key) => { removed = key; } },
    documentTarget: {},
    requireToken: () => { opened++; },
    toast: () => assert.fail("must not toast after a confirmed unauthorized response"),
  });
  await handler();
  assert.equal(removed, "pi_ui_token");
  assert.equal(opened, 1);
});

test("unauthorized handler retains auth and reports transient failures", async () => {
  const notices = [];
  const handler = createUnauthorizedHandler({
    fetchImpl: async () => { throw new Error("offline"); },
    storage: { removeItem: () => assert.fail("must retain token") },
    documentTarget: {},
    requireToken: () => assert.fail("must not open auth gate"),
    toast: (...args) => notices.push(args),
  });
  await handler();
  assert.deepEqual(notices, [["network error — retry", "warning"]]);
});

test("auth browser service persists a token and reloads through injected operations", () => {
  const calls = [];
  const service = createAuthBrowserService({
    storage: { setItem: (...args) => calls.push(["save", ...args]) },
    reload: () => calls.push(["reload"]),
  });

  service.saveToken("secret-token");
  service.reload();

  assert.deepEqual(calls, [["save", AUTH_TOKEN_KEY, "secret-token"], ["reload"]]);
});

test("AuthGate delegates browser effects without direct browser globals", () => {
  const source = readFileSync(new URL("../public/src/components/AuthGate.svelte", import.meta.url), "utf8");
  assert.match(source, /getAuthBrowser\(\)/);
  assert.match(source, /authBrowser\.saveToken\(token\)/);
  assert.match(source, /authBrowser\.reload\(\)/);
  assert.doesNotMatch(source, /localStorage|location\.reload/);
});
