import test from "node:test";
import assert from "node:assert/strict";
import { CREDENTIAL_BODY_LIMIT, CREDENTIAL_KEY_LIMIT, createCredentialRoutes } from "../http/routes/credentialRoutes.mjs";
import { createRequestContext } from "../http/createRequestContext.mjs";

function response() {
  return { status: null, body: null };
}

function context() {
  return {
    json(res, status, body) { res.status = status; res.body = body; },
    async readBody(req, limit) {
      if (req.readError) throw req.readError;
      const raw = req.raw ?? JSON.stringify(req.body);
      if (Buffer.byteLength(raw) > limit) {
        const error = new Error("body too large");
        error.code = "body_too_large";
        throw error;
      }
      return raw;
    },
  };
}

test("credential routes expose only the exact authenticated API-key methods", () => {
  const routes = createCredentialRoutes({
    requestContext: context(),
    credentialService: { listProviders() {} },
  });
  assert.deepEqual(Object.keys(routes), ["GET /api-keys", "POST /api-keys", "DELETE /api-keys"]);
});

test("credential GET returns only the service safe provider read model", async () => {
  const providers = [{
    provider: "openai", displayName: "OpenAI", registered: true,
    credentialType: "api_key", source: "stored_api_key", configured: true,
  }];
  const routes = createCredentialRoutes({
    requestContext: context(),
    credentialService: { async listProviders() { return providers; } },
  });
  const res = response();
  await routes["GET /api-keys"]({}, res);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { providers });
});

test("credential mutations require bounded input and explicit restart confirmation", async () => {
  let writes = 0;
  const routes = createCredentialRoutes({
    requestContext: context(),
    credentialService: {
      async setApiKey() { writes += 1; },
      async removeApiKey() { writes += 1; },
    },
    restartActiveRunners: async () => ({ runnerIds: [], status: "restarted" }),
  });
  for (const body of [
    null,
    {},
    { provider: "openai", key: "key", restart: false },
    { provider: "openai", key: "", restart: true },
    { provider: "openai", key: "x".repeat(CREDENTIAL_KEY_LIMIT + 1), restart: true },
  ]) {
    const res = response();
    await routes["POST /api-keys"]({ body }, res);
    assert.equal(res.status, 400);
  }
  const remove = response();
  await routes["DELETE /api-keys"]({ body: { provider: "openai" } }, remove);
  assert.equal(remove.status, 400);
  assert.equal(writes, 0);
});

test("credential mutations reject URLs with query data before reading secret bodies", async () => {
  let reads = 0;
  const requestContext = context();
  const originalReadBody = requestContext.readBody;
  requestContext.readBody = (...args) => { reads += 1; return originalReadBody(...args); };
  const routes = createCredentialRoutes({ requestContext, credentialService: {}, restartActiveRunners() {} });
  const res = response();
  await routes["POST /api-keys"](
    { body: { provider: "openai", key: "url-canary", restart: true } },
    res,
    new URL("http://localhost/api-keys?key=url-canary"),
  );
  assert.equal(res.status, 400);
  assert.equal(reads, 0);
  assert.doesNotMatch(JSON.stringify(res.body), /url-canary/);
});

test("authentication failures never inspect or log credential request bodies", () => {
  const logs = [];
  const requestContext = createRequestContext({
    config: { TOKEN: "ui-token", PI_DIR: process.cwd(), DIRNAME: process.cwd() },
    authFails: new Map(),
  }, { logger: { log: (line) => logs.push(line) } });
  const canary = "auth-body-canary";
  const req = {
    method: "POST",
    headers: { authorization: "Bearer wrong", "user-agent": "test" },
    socket: { remoteAddress: "192.0.2.8" },
    body: JSON.stringify({ provider: "openai", key: canary, restart: true }),
  };
  assert.equal(requestContext.checkAuth(req, new URL("http://localhost/api-keys")), "fail");
  assert.doesNotMatch(logs.join("\n"), new RegExp(canary));
});

test("credential routes return stable safe statuses for malformed bodies and service errors", async () => {
  const oversizedRoutes = createCredentialRoutes({
    requestContext: context(), credentialService: {}, restartActiveRunners() {},
  });
  const oversized = response();
  await oversizedRoutes["POST /api-keys"]({ raw: "x".repeat(CREDENTIAL_BODY_LIMIT + 1) }, oversized);
  assert.deepEqual(oversized, { status: 413, body: { error: "request body too large" } });
  const malformed = response();
  await oversizedRoutes["POST /api-keys"]({ raw: '{"key":"malformed-canary"' }, malformed);
  assert.equal(malformed.status, 400);
  assert.doesNotMatch(JSON.stringify(malformed.body), /malformed-canary/);

  for (const [code, status] of [
    ["invalid_provider", 400],
    ["unknown_provider", 404],
    ["credential_not_found", 404],
    ["oauth_conflict", 409],
    ["credential_service_unavailable", 503],
  ]) {
    const routes = createCredentialRoutes({
      requestContext: context(),
      credentialService: {
        async setApiKey() { const error = new Error("submitted-canary must stay private"); error.code = code; throw error; },
      },
      restartActiveRunners: async () => ({}),
    });
    const res = response();
    await routes["POST /api-keys"]({ body: { provider: "provider", key: "submitted-canary", restart: true } }, res);
    assert.equal(res.status, status);
    assert.equal(res.body.code, code);
    assert.doesNotMatch(JSON.stringify(res.body), /submitted-canary/);
  }
});

test("credential mutations return safe results and restart after the durable write", async () => {
  const calls = [];
  const routes = createCredentialRoutes({
    requestContext: context(),
    credentialService: {
      async setApiKey(provider, key) {
        calls.push(["set", provider, key]);
        return { provider, credentialType: "api_key" };
      },
      async removeApiKey(provider) {
        calls.push(["remove", provider]);
        return { provider, removed: true };
      },
    },
    async restartActiveRunners() {
      calls.push(["restart"]);
      return { runnerIds: ["runner-1"], status: "restarted" };
    },
  });

  const added = response();
  await routes["POST /api-keys"]({ body: { provider: " openai ", key: "submitted-canary", restart: true } }, added);
  assert.equal(added.status, 200);
  assert.deepEqual(calls.slice(0, 2), [["set", "openai", "submitted-canary"], ["restart"]]);
  assert.doesNotMatch(JSON.stringify(added.body), /submitted-canary/);

  const removed = response();
  await routes["DELETE /api-keys"]({ body: { provider: "openai", restart: true } }, removed);
  assert.equal(removed.status, 200);
  assert.deepEqual(calls.slice(2), [["remove", "openai"], ["restart"]]);
});

test("credential routes report durable writes followed by partial restart failures", async () => {
  const routes = createCredentialRoutes({
    requestContext: context(),
    credentialService: {
      async setApiKey(provider) { return { provider, credentialType: "api_key" }; },
    },
    restartActiveRunners: async () => ({
      runnerIds: ["ok", "failed"], status: "partial", failedRunnerIds: ["failed"],
    }),
  });
  const res = response();
  await routes["POST /api-keys"]({ body: { provider: "openai", key: "partial-canary", restart: true } }, res);
  assert.equal(res.status, 503);
  assert.equal(res.body.credential.provider, "openai");
  assert.deepEqual(res.body.restart.failedRunnerIds, ["failed"]);
  assert.match(res.body.error, /credential saved/);
  assert.doesNotMatch(JSON.stringify(res.body), /partial-canary/);
});

test("credential mutations cannot write until restart lifecycle is composed", async () => {
  let wrote = false;
  const routes = createCredentialRoutes({
    requestContext: context(),
    credentialService: {
      async setApiKey() { wrote = true; },
    },
  });
  const res = response();
  await routes["POST /api-keys"]({ body: { provider: "openai", key: "secret", restart: true } }, res);
  assert.equal(res.status, 503);
  assert.equal(wrote, false);
  assert.doesNotMatch(JSON.stringify(res.body), /secret/);
});
