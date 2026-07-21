import test from "node:test";
import assert from "node:assert/strict";
import { createCredentialsController } from "../public/src/features/credentials/createCredentialsController.js";

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function harness(responses, confirmations = []) {
  const calls = [];
  const states = [];
  const toasts = [];
  const confirms = [];
  const controller = createCredentialsController({
    async fetchImpl(path, options = {}) {
      calls.push({ path, options });
      const next = responses.shift();
      if (!next) throw new Error("missing mock response");
      return next;
    },
    async confirm(title, message) {
      confirms.push({ title, message });
      return confirmations.shift() ?? false;
    },
    toast(message, kind) { toasts.push({ message, kind }); },
    setState(patch) { states.push(patch); },
  });
  return { controller, calls, states, toasts, confirms };
}

test("API-key controller owns loading and safe provider state", async () => {
  const providers = [{ provider: "openai", displayName: "OpenAI", credentialType: null, source: "not_configured" }];
  const item = harness([response(200, { providers })]);
  assert.deepEqual(await item.controller.load(), providers);
  assert.deepEqual(item.states, [
    { loading: true, error: "" },
    { providers, loading: false, error: "" },
  ]);
  assert.equal(item.calls[0].path, "/api-keys");
});

test("API-key controller confirms replacement, restarts, refreshes, and never publishes the key", async () => {
  const stored = [{ provider: "openai", displayName: "OpenAI", credentialType: "api_key", source: "stored_api_key" }];
  const item = harness([
    response(200, { providers: stored }),
    response(200, { credential: { provider: "openai", credentialType: "api_key" }, restart: { status: "restarted", runnerIds: ["r1"] } }),
    response(200, { providers: stored }),
  ], [true]);
  await item.controller.load();
  const result = await item.controller.save({ provider: "openai", key: "save-canary-secret" });
  assert.equal(result.ok, true);
  assert.match(item.confirms[0].title, /Replace API key for OpenAI/);
  assert.match(item.confirms[0].message, /restart every active pi process/);
  const mutation = item.calls.find((call) => call.options.method === "POST");
  assert.deepEqual(JSON.parse(mutation.options.body), { provider: "openai", key: "save-canary-secret", restart: true });
  assert.doesNotMatch(JSON.stringify(item.states), /save-canary-secret/);
  assert.doesNotMatch(JSON.stringify(item.toasts), /save-canary-secret/);
});

test("API-key controller confirms removal semantics and warns after fallback becomes active", async () => {
  const stored = [{ provider: "custom", displayName: "Custom", credentialType: "api_key", source: "stored_api_key" }];
  const fallback = [{ provider: "custom", displayName: "Custom", credentialType: null, source: "models_json" }];
  const item = harness([
    response(200, { providers: stored }),
    response(200, { credential: { provider: "custom", removed: true }, restart: { status: "restarted", runnerIds: [] } }),
    response(200, { providers: fallback }),
  ], [true]);
  await item.controller.load();
  assert.equal((await item.controller.remove("custom")).ok, true);
  assert.match(item.confirms[0].title, /Remove API key for Custom/);
  assert.match(item.confirms[0].message, /does not revoke the key at the provider/);
  assert.match(item.toasts.at(-1).message, /models\.json/);
  assert.deepEqual(JSON.parse(item.calls.find((call) => call.options.method === "DELETE").options.body), {
    provider: "custom", restart: true,
  });
});

test("API-key controller reports safe errors, cancellation, and partial restart feedback", async () => {
  const providers = [{ provider: "openai", displayName: "OpenAI", credentialType: null }];
  const cancelled = harness([response(200, { providers })], [false]);
  await cancelled.controller.load();
  assert.deepEqual(await cancelled.controller.save({ provider: "openai", key: "cancelled-canary" }), { ok: false, cancelled: true });
  assert.equal(cancelled.calls.length, 1);

  const partial = harness([
    response(200, { providers }),
    response(503, {
      error: "credential saved but some pi runners failed to restart",
      credential: { provider: "openai", credentialType: "api_key" },
      restart: { status: "partial", runnerIds: ["r1"], failedRunnerIds: ["r1"] },
    }),
    response(200, { providers }),
  ], [true]);
  await partial.controller.load();
  const result = await partial.controller.save({ provider: "openai", key: "partial-canary-secret" });
  assert.deepEqual(result, { ok: false, saved: true, restart: { status: "partial", runnerIds: ["r1"], failedRunnerIds: ["r1"] } });
  assert.match(partial.toasts.at(-1).message, /restart was incomplete/);
  assert.doesNotMatch(JSON.stringify(partial.states), /partial-canary-secret/);
});

test("credentials controller starts, polls, responds to, cancels, and re-authenticates OAuth flows", async () => {
  const flowId = "a".repeat(64);
  const requestId = "b".repeat(64);
  const providers = [{ provider: "mock", displayName: "Mock", credentialType: "oauth", oauthCapable: true }];
  const calls = [];
  const states = [];
  const confirmations = [];
  const timers = [];
  const responses = [
    response(200, { providers }),
    response(202, { flow: { flowId, provider: "mock", status: "pending", requests: [] } }),
    response(200, { flow: { flowId, provider: "mock", status: "pending", requests: [{ requestId, kind: "prompt", message: "Domain" }] } }),
    response(202, { flow: { flowId, provider: "mock", status: "pending", requests: [] } }),
    response(200, { flow: { flowId, provider: "mock", status: "cancelled" } }),
  ];
  const controller = createCredentialsController({
    async fetchImpl(path, options = {}) { calls.push({ path, options }); return responses.shift(); },
    async confirm(title, message) { confirmations.push({ title, message }); return true; },
    setState: (patch) => states.push(patch),
    setTimer: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimer: () => {},
  });
  controller.activate();
  await controller.load();
  assert.equal((await controller.startOAuth("mock")).ok, true);
  assert.match(confirmations[0].title, /Re-authenticate Mock/);
  assert.deepEqual(JSON.parse(calls[1].options.body), { provider: "mock", replace: true });
  assert.ok(timers.every((timer) => timer.delay >= 500 && timer.delay <= 3000));

  await controller.poll();
  assert.equal(states.at(-1).flow.requests[0].requestId, requestId);
  assert.equal((await controller.respondOAuth({ requestId, value: "response-canary" })).ok, true);
  assert.deepEqual(JSON.parse(calls[3].options.body), { flowId, requestId, value: "response-canary" });
  assert.doesNotMatch(JSON.stringify(states), /response-canary/);
  assert.equal((await controller.cancelOAuth()).ok, true);
  assert.deepEqual(JSON.parse(calls[4].options.body), { flowId });
  controller.teardown();
});

test("credentials controller logs out locally with fallback and partial restart feedback", async () => {
  const providers = [{ provider: "mock", displayName: "Mock", credentialType: "oauth", source: "stored_oauth" }];
  const item = harness([
    response(200, { providers }),
    response(503, {
      error: "OAuth credential removed but restart incomplete",
      credential: { provider: "mock", removed: true }, upstreamRevoked: false, source: "environment",
      restart: { status: "partial", runnerIds: ["r1"], failedRunnerIds: ["r1"] },
    }),
    response(200, { providers: [{ ...providers[0], credentialType: null, source: "environment" }] }),
  ], [true]);
  await item.controller.load();
  const result = await item.controller.logoutOAuth("mock");
  assert.equal(result.removed, true);
  assert.equal(result.source, "environment");
  assert.match(item.confirms[0].title, /Sign out Mock from pi/);
  assert.match(item.confirms[0].message, /does not revoke access at the provider/);
  assert.match(item.toasts.at(-1).message, /restart was incomplete/);
  assert.deepEqual(JSON.parse(item.calls[1].options.body), { provider: "mock", restart: true });
});

test("API-key controller teardown aborts requests and clears safe state", async () => {
  let observedSignal;
  const states = [];
  const controller = createCredentialsController({
    fetchImpl(_path, options) {
      observedSignal = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    },
    confirm: async () => true,
    setState: (patch) => states.push(patch),
  });
  const loading = controller.load();
  controller.teardown();
  await loading;
  assert.equal(observedSignal.aborted, true);
  assert.deepEqual(states.at(-1), { providers: [], flow: null, loading: false, error: "", lastRestart: null });
});
