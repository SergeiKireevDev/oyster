import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clearAuthToken, createUnauthorizedHandler, initializeAuth, installAuthenticatedFetch, showAuthGate, UNAUTHENTICATED_CLIENT_TOKEN } from "../public/src/runtime/authClient.js";
import { AUTH_TOKEN_KEY, createAuthBrowserService } from "../public/src/runtime/authBrowserService.js";

test("explicit server runtime config boots the client without persisting an authentication token", () => {
  const storage = {
    getItem: () => assert.fail("must not read token storage"),
    setItem: () => assert.fail("must not write token storage"),
  };
  const token = initializeAuth({
    runtimeConfig: { unauthenticated: true },
    locationTarget: { hash: "", search: "", pathname: "/" },
    historyTarget: { replaceState: () => assert.fail("must not rewrite history") },
    storage,
    documentTarget: {},
  });
  assert.equal(token, UNAUTHENTICATED_CLIENT_TOKEN);
});

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
  assert.equal(removed, "oyster_token");
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
  assert.equal(removed, "oyster_token");
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

test("auth browser service validates the submitted token rather than another browser credential", async () => {
  const calls = [];
  const reports = [
    { authorized: true, credentials: { cookie: "valid", xAuthToken: "present-invalid(len=5)" } },
    { authorized: true, credentials: { cookie: "absent", xAuthToken: "valid" } },
  ];
  const service = createAuthBrowserService({
    storage: {},
    reload() {},
    fetchImpl: async (...args) => {
      calls.push(args);
      return { ok: true, async json() { return reports.shift(); } };
    },
  });

  assert.equal(await service.validateToken("wrong"), false);
  assert.equal(await service.validateToken("correct"), true);
  assert.deepEqual(calls, [
    ["/authcheck", { headers: { "x-auth-token": "wrong" } }],
    ["/authcheck", { headers: { "x-auth-token": "correct" } }],
  ]);
});

test("AuthGate retains failed authentication and exposes an inline error", () => {
  const source = readFileSync(new URL("../public/src/components/AuthGate.svelte", import.meta.url), "utf8");
  const style = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");
  assert.match(source, /getAuthBrowser\(\)/);
  assert.match(source, /if \(!await authBrowser\.validateToken\(token\)\)/);
  assert.ok(source.indexOf("validateToken(token)") < source.indexOf("saveToken(token)"));
  assert.match(source, /class="gate-error"[^>]*role="alert"[^>]*aria-atomic="true"/);
  assert.match(source, /Authentication failed/);
  assert.match(style, /#gate \.gate-error\s*\{[^}]*color: var\(--red\)/s);
  assert.match(source, /authBrowser\.saveToken\(token\)/);
  assert.match(source, /tokenInput = "";\s*authBrowser\.reload\(\)/);
  assert.doesNotMatch(source, /localStorage|location\.reload/);
});

test("AuthGate exposes an accessible, password-manager-friendly authentication dialog", () => {
  const source = readFileSync(new URL("../public/src/components/AuthGate.svelte", import.meta.url), "utf8");

  assert.match(source, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="gateTitle"/);
  assert.match(source, /<form class="card" onsubmit=\{submit\} aria-busy=\{connecting\}>/);
  assert.match(source, /autocomplete="current-password"/);
  assert.match(source, /autocapitalize="none"/);
  assert.match(source, /spellcheck="false"/);
  assert.match(source, /aria-describedby=\{inputDescription\}/);
  assert.match(source, /readonly=\{connecting\}/);
  assert.doesNotMatch(source, /disabled=\{connecting\}[\s\S]*required/);
});
