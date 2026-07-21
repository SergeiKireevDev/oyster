import test from "node:test";
import assert from "node:assert/strict";
import { OAUTH_BODY_LIMIT, createOAuthRoutes } from "../http/routes/oauthRoutes.mjs";

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
    credential: { provider: "mock", removed: true }, restart: { status: "restarted", runnerIds: [] },
  });
});
