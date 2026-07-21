import test from "node:test";
import assert from "node:assert/strict";
import { OAUTH_BODY_LIMIT, createOAuthRoutes } from "../server/http/routes/oauthRoutes.mjs";

const FLOW_ID = "a".repeat(64);
const REQUEST_ID = "b".repeat(64);

function response() { return { status: null, body: null }; }
function context() {
  return {
    json(res, status, body) { res.status = status; res.body = body; },
    async readBody(req, limit) {
      const raw = req.raw ?? JSON.stringify(req.body);
      if (Buffer.byteLength(raw) > limit) throw Object.assign(new Error("large"), { code: "body_too_large" });
      return raw;
    },
  };
}

function dependencies(overrides = {}) {
  return {
    requestContext: context(),
    credentialService: {
      async listProviders() {
        return [{ provider: "mock", oauthCapable: true, credentialType: null }];
      },
      async logoutOAuth(provider) { return { provider, removed: true }; },
    },
    flowService: {
      start(provider) { return { flowId: FLOW_ID, provider, status: "pending" }; },
      getStatus() { return { flowId: FLOW_ID, provider: "mock", status: "pending" }; },
      respond() { return { flowId: FLOW_ID, provider: "mock", status: "pending" }; },
      cancel() { return { flowId: FLOW_ID, provider: "mock", status: "cancelled" }; },
    },
    restartActiveRunners: async () => ({ status: "restarted", runnerIds: [] }),
    ...overrides,
  };
}

test("OAuth routes expose only exact bounded-JSON endpoints", async () => {
  const routes = createOAuthRoutes(dependencies());
  assert.deepEqual(Object.keys(routes), [
    "POST /oauth/start", "POST /oauth/status", "POST /oauth/respond", "POST /oauth/cancel", "DELETE /oauth",
  ]);

  const oversized = response();
  await routes["POST /oauth/respond"]({ raw: "x".repeat(OAUTH_BODY_LIMIT + 1) }, oversized);
  assert.equal(oversized.status, 413);
  const queried = response();
  await routes["POST /oauth/start"](
    { body: { provider: "mock", replace: false } }, queried,
    new URL("http://localhost/oauth/start?code=url-canary"),
  );
  assert.equal(queried.status, 400);
  assert.doesNotMatch(JSON.stringify(queried.body), /url-canary/);
});

test("OAuth start validates provider capability and explicit replacement", async () => {
  const routes = createOAuthRoutes(dependencies({
    credentialService: {
      async listProviders() {
        return [
          { provider: "stored", oauthCapable: true, credentialType: "oauth" },
          { provider: "api-only", oauthCapable: false, credentialType: "api_key" },
        ];
      },
    },
  }));
  for (const [body, status] of [
    [{ provider: "stored" }, 400],
    [{ provider: "stored", replace: false }, 409],
    [{ provider: "api-only", replace: true }, 404],
  ]) {
    const res = response();
    await routes["POST /oauth/start"]({ body }, res);
    assert.equal(res.status, status);
  }
  const accepted = response();
  await routes["POST /oauth/start"]({ body: { provider: "stored", replace: true } }, accepted);
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.flow.flowId, FLOW_ID);
});

test("OAuth routes map failures to stable safe statuses without echoing inputs", async () => {
  const cases = [
    ["invalid_provider", 400],
    ["oauth_invalid_response", 400],
    ["oauth_provider_not_found", 404],
    ["oauth_flow_not_found", 404],
    ["credential_not_found", 404],
    ["credential_busy", 409],
    ["credential_replace_required", 409],
    ["credential_type_conflict", 409],
    ["oauth_flow_limit", 409],
    ["oauth_response_stale", 409],
    ["oauth_flow_inactive", 409],
    ["credential_service_unavailable", 503],
    ["secret-code-canary", 503],
  ];
  for (const [code, expected] of cases) {
    const routes = createOAuthRoutes(dependencies({
      flowService: {
        start() { throw Object.assign(new Error("provider-error-canary"), { code }); },
        getStatus() {}, respond() {}, cancel() {},
      },
    }));
    const res = response();
    await routes["POST /oauth/start"]({ body: { provider: "mock", replace: false, secret: "body-canary" } }, res);
    assert.equal(res.status, expected, code);
    assert.doesNotMatch(JSON.stringify(res.body), /provider-error|body-canary|secret-code/);
    if (code === "secret-code-canary") assert.equal(res.body.code, "credential_service_unavailable");
  }

  const malformedRoutes = createOAuthRoutes(dependencies());
  const malformed = response();
  await malformedRoutes["POST /oauth/respond"]({ raw: '{"value":"malformed-canary"' }, malformed);
  assert.equal(malformed.status, 400);
  assert.doesNotMatch(JSON.stringify(malformed.body), /malformed-canary/);

  const restartFailure = createOAuthRoutes(dependencies({
    restartActiveRunners: async () => { throw new Error("restart-canary"); },
  }));
  const res = response();
  await restartFailure["DELETE /oauth"]({ body: { provider: "mock", restart: true } }, res);
  assert.equal(res.status, 503);
  assert.doesNotMatch(JSON.stringify(res.body), /restart-canary/);
});

test("OAuth logout reports fallback and durable success when runner restart is incomplete", async () => {
  for (const restartFailure of ["partial", "throw"]) {
    const order = [];
    const routes = createOAuthRoutes(dependencies({
      credentialService: {
        async listProviders() {
          order.push("status");
          return [{ provider: "mock", oauthCapable: true, credentialType: null, source: "environment" }];
        },
        async logoutOAuth(provider) { order.push("logout"); return { provider, removed: true }; },
      },
      restartActiveRunners: async () => {
        order.push("restart");
        if (restartFailure === "throw") throw new Error("restart-secret-canary");
        return { status: "partial", runnerIds: ["runner-a"], failedRunnerIds: ["runner-a"] };
      },
    }));
    const res = response();
    await routes["DELETE /oauth"]({ body: { provider: "mock", restart: true } }, res);
    assert.equal(res.status, 503);
    assert.deepEqual(order, ["logout", "status", "restart"]);
    assert.deepEqual(res.body.credential, { provider: "mock", removed: true });
    assert.equal(res.body.source, "environment");
    assert.equal(res.body.upstreamRevoked, false);
    assert.equal(res.body.restart.status, restartFailure === "throw" ? "failed" : "partial");
    assert.match(res.body.error, /credential removed/);
    assert.doesNotMatch(JSON.stringify(res.body), /restart-secret-canary/);
  }

  let restarts = 0;
  const busy = createOAuthRoutes(dependencies({
    credentialService: {
      async listProviders() { return []; },
      async logoutOAuth() { throw Object.assign(new Error("busy"), { code: "credential_busy" }); },
    },
    restartActiveRunners: async () => { restarts += 1; },
  }));
  const res = response();
  await busy["DELETE /oauth"]({ body: { provider: "mock", restart: true } }, res);
  assert.equal(res.status, 409);
  assert.equal(restarts, 0);
});

test("OAuth polling, response, cancellation, and logout keep flow data in JSON bodies", async () => {
  const calls = [];
  const routes = createOAuthRoutes(dependencies({
    flowService: {
      getStatus(flowId) { calls.push(["status", flowId]); return { flowId, status: "pending" }; },
      respond(flowId, requestId, value) { calls.push(["respond", flowId, requestId, value]); return { flowId, status: "pending" }; },
      cancel(flowId) { calls.push(["cancel", flowId]); return { flowId, status: "cancelled" }; },
      start() {},
    },
  }));
  const status = response();
  await routes["POST /oauth/status"]({ body: { flowId: FLOW_ID } }, status);
  assert.equal(status.status, 200);
  const respond = response();
  await routes["POST /oauth/respond"]({ body: { flowId: FLOW_ID, requestId: REQUEST_ID, value: "manual-code-canary" } }, respond);
  assert.equal(respond.status, 202);
  assert.doesNotMatch(JSON.stringify(respond.body), /manual-code-canary/);
  const cancel = response();
  await routes["POST /oauth/cancel"]({ body: { flowId: FLOW_ID } }, cancel);
  assert.equal(cancel.status, 200);
  assert.deepEqual(calls, [
    ["status", FLOW_ID], ["respond", FLOW_ID, REQUEST_ID, "manual-code-canary"], ["cancel", FLOW_ID],
  ]);

  const logoutMissingConfirmation = response();
  await routes["DELETE /oauth"]({ body: { provider: "mock", restart: false } }, logoutMissingConfirmation);
  assert.equal(logoutMissingConfirmation.status, 400);
  const logout = response();
  await routes["DELETE /oauth"]({ body: { provider: "mock", restart: true } }, logout);
  assert.equal(logout.status, 200);
  assert.deepEqual(logout.body, {
    credential: { provider: "mock", removed: true },
    source: "not_configured",
    upstreamRevoked: false,
    restart: { status: "restarted", runnerIds: [] },
  });
});
