import test from "node:test";
import assert from "node:assert/strict";
import { createPiOAuthFlowService } from "../pi-oauth-flow-service.mjs";

function deterministicBytes() {
  let value = 0;
  return () => Buffer.alloc(32, ++value);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("OAuth flow coordinator uses host registry, random IDs, and safe snapshots", async () => {
  const registry = new Map();
  const login = deferred();
  const credentialCanary = { access: "access-token-canary", refresh: "refresh-token-canary" };
  const service = createPiOAuthFlowService({
    registry,
    credentialService: { loginOAuth: () => login.promise },
    randomBytes: deterministicBytes(),
    now: (() => { let value = 100; return () => ++value; })(),
  });

  const started = service.start(" mock-provider ");
  assert.match(started.flowId, /^[0-9a-f]{64}$/);
  assert.deepEqual(started, {
    flowId: started.flowId,
    provider: "mock-provider",
    status: "pending",
    phase: "starting",
    createdAt: 101,
    updatedAt: 101,
  });
  assert.equal(registry.has(started.flowId), true);
  assert.deepEqual(service.getStatus(started.flowId), started);
  assert.equal(service.getStatus("missing"), null);
  assert.doesNotMatch(JSON.stringify(started), /token-canary/);

  login.resolve(credentialCanary);
  await settle();
  const completed = service.getStatus(started.flowId);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.phase, "complete");
  assert.equal(completed.updatedAt, 102);
  assert.doesNotMatch(JSON.stringify(completed), /access|refresh|token-canary/);
});

test("OAuth flow coordinator adapts interactive callbacks with one-time bounded responses", async () => {
  const registry = new Map();
  const login = deferred();
  let callbacks;
  const service = createPiOAuthFlowService({
    registry,
    credentialService: {
      loginOAuth(_provider, value) { callbacks = value; return login.promise; },
    },
    randomBytes: deterministicBytes(),
    now: (() => { let value = 200; return () => ++value; })(),
  });
  const started = service.start("interactive");
  await settle();

  callbacks.onAuth({ url: "https://auth.invalid/start?state=transient", instructions: "Sign in" });
  callbacks.onDeviceCode({
    userCode: "USER-1234", verificationUri: "https://auth.invalid/device",
    intervalSeconds: 5, expiresInSeconds: 900,
  });
  callbacks.onProgress("Waiting for input");
  const promptPromise = callbacks.onPrompt({ message: "Enterprise domain", placeholder: "example.com" });
  const manualPromise = callbacks.onManualCodeInput();
  const selectPromise = callbacks.onSelect({
    message: "Choose method",
    options: [{ id: "browser", label: "Browser" }, { id: "device", label: "Device" }],
  });

  let status = service.getStatus(started.flowId);
  assert.equal(status.authorization.url, "https://auth.invalid/start?state=transient");
  assert.equal(status.deviceCode.userCode, "USER-1234");
  assert.equal(status.progress, "Waiting for input");
  assert.equal(status.requests.length, 3);
  assert.equal(new Set(status.requests.map((request) => request.requestId)).size, 3);
  assert.ok(status.requests.every((request) => /^[0-9a-f]{64}$/.test(request.requestId)));

  const prompt = status.requests.find((request) => request.kind === "prompt");
  const manual = status.requests.find((request) => request.kind === "manual_code");
  const select = status.requests.find((request) => request.kind === "select");
  status = service.respond(started.flowId, prompt.requestId, "corp.example");
  assert.doesNotMatch(JSON.stringify(status), /corp\.example/);
  assert.equal(await promptPromise, "corp.example");
  assert.throws(() => service.respond(started.flowId, prompt.requestId, "replay-canary"), { code: "oauth_response_stale" });
  assert.throws(() => service.respond(started.flowId, select.requestId, "unknown"), { code: "oauth_invalid_response" });
  service.respond(started.flowId, select.requestId, "device");
  service.respond(started.flowId, manual.requestId, "redirect-code-canary");
  assert.equal(await selectPromise, "device");
  assert.equal(await manualPromise, "redirect-code-canary");

  login.resolve({ access: "access-canary", refresh: "refresh-canary" });
  await settle();
  status = service.getStatus(started.flowId);
  assert.equal(status.status, "succeeded");
  assert.equal(status.authorization, undefined);
  assert.equal(status.deviceCode, undefined);
  assert.equal(status.requests, undefined);
  assert.doesNotMatch(JSON.stringify(status), /canary|USER-1234|transient/);
});

test("OAuth flow coordinator enforces provider and global active limits", async () => {
  const registry = new Map();
  const pending = [];
  const service = createPiOAuthFlowService({
    registry,
    credentialService: {
      loginOAuth() {
        const item = deferred();
        pending.push(item);
        return item.promise;
      },
    },
    randomBytes: deterministicBytes(),
    maxActiveFlows: 2,
  });

  service.start("alpha");
  assert.throws(() => service.start("alpha"), { code: "credential_busy" });
  service.start("beta");
  assert.throws(() => service.start("gamma"), { code: "oauth_flow_limit" });
  await settle();
  pending[0].resolve({ credentialType: "oauth" });
  await settle();
  assert.equal(service.start("gamma").provider, "gamma");
  pending[1].resolve({ credentialType: "oauth" });
});

test("OAuth flow coordinator cancels, expires, and shuts down flows with cleanup", async () => {
  const registry = new Map();
  const timers = new Map();
  let timerId = 0;
  const setTimer = (callback, delay) => {
    const id = ++timerId;
    const timer = { id, callback: () => { timers.delete(id); callback(); }, delay, unref() {} };
    timers.set(timer.id, timer);
    return timer;
  };
  const clearTimer = (timer) => timers.delete(timer.id);
  let callbacks;
  let providerActive = false;
  const credentialService = {
    loginOAuth(_provider, value) {
      callbacks = value;
      providerActive = true;
      return new Promise((_resolve, reject) => value.signal.addEventListener("abort", () => {
        providerActive = false;
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true }));
    },
  };
  const service = createPiOAuthFlowService({
    registry, credentialService, randomBytes: deterministicBytes(),
    inactivityMs: 1000, terminalRetentionMs: 2000, setTimer, clearTimer,
  });

  const started = service.start("cancel-me");
  await settle();
  const prompt = callbacks.onPrompt({ message: "Secret response" });
  const cancelled = service.cancel(started.flowId);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.failureCode, "oauth_cancelled");
  assert.equal(callbacks.signal.aborted, true);
  await assert.rejects(prompt, { code: "oauth_flow_inactive" });
  await settle();
  assert.equal(providerActive, false);
  assert.equal(service.getStatus(started.flowId).requests, undefined);
  const terminalTimer = [...timers.values()].find((timer) => timer.delay === 2000);
  terminalTimer.callback();
  assert.equal(service.getStatus(started.flowId), null);

  const expiring = service.start("expire-me");
  await settle();
  const inactivityTimer = [...timers.values()].find((timer) => timer.delay === 1000);
  inactivityTimer.callback();
  assert.equal(service.getStatus(expiring.flowId).status, "cancelled");
  assert.equal(service.getStatus(expiring.flowId).failureCode, "oauth_flow_expired");

  service.start("shutdown-me");
  await settle();
  service.shutdown();
  assert.equal(registry.size, 0);
  assert.equal(timers.size, 0);
});

test("OAuth flow coordinator redacts provider failures and reuses supplied state", async () => {
  const registry = new Map();
  const first = createPiOAuthFlowService({
    registry,
    credentialService: {
      async loginOAuth() { throw Object.assign(new Error("authorization-code-canary"), { code: "upstream_secret_error" }); },
    },
    randomBytes: deterministicBytes(),
  });
  const started = first.start("broken");
  await settle();

  const replacement = createPiOAuthFlowService({
    registry,
    credentialService: { async loginOAuth() {} },
    randomBytes: deterministicBytes(),
  });
  const status = replacement.getStatus(started.flowId);
  assert.equal(status.status, "failed");
  assert.equal(status.failureCode, "oauth_failed");
  assert.doesNotMatch(JSON.stringify(status), /authorization|canary|upstream_secret/);
});
