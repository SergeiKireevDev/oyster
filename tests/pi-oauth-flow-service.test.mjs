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
