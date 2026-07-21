import test from "node:test";
import assert from "node:assert/strict";
import { CREDENTIAL_KEY_LIMIT, createCredentialRoutes } from "../http/routes/credentialRoutes.mjs";

function response() {
  return { status: null, body: null };
}

function context() {
  return {
    json(res, status, body) { res.status = status; res.body = body; },
    async readJsonBody(req) { return req.body; },
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
