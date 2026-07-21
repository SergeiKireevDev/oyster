import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createOAuthRoutes } from "../http/routes/oauthRoutes.mjs";
import { createPiOAuthFlowService } from "../pi-oauth-flow-service.mjs";
import { openAppStore } from "../persistence/appStore.mjs";

function filesBelow(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(child) : [child];
  });
}

function sqliteContains(databasePath, canary) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    for (const { name } of database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      const table = `"${name.replaceAll('"', '""')}"`;
      for (const column of database.prepare(`PRAGMA table_info(${table})`).all()) {
        if (!/TEXT/i.test(column.type)) continue;
        const field = `"${column.name.replaceAll('"', '""')}"`;
        if (database.prepare(`SELECT 1 FROM ${table} WHERE instr(${field}, ?) > 0 LIMIT 1`).get(canary)) return true;
      }
    }
    return false;
  } finally { database.close(); }
}

function context() {
  return {
    json(res, status, body) { res.status = status; res.body = body; },
    async readBody(req) { return JSON.stringify(req.body); },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const escaped = (value) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

test("OAuth tokens persist only in Pi auth while callback material remains transient", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-oauth-canary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  const authPath = join(agentDir, "auth.json");
  writeFileSync(authPath, "{}", { mode: 0o600 });
  chmodSync(authPath, 0o600);

  const databasePath = join(root, "pi-lot-ui.sqlite");
  const appStore = openAppStore({ databasePath });
  appStore.repositories.settings.set("ordinary", JSON.stringify({ theme: "dark" }), "now");
  appStore.close();

  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const secrets = {
    access: `OAUTH_ACCESS_CANARY_${suffix}`,
    refresh: `OAUTH_REFRESH_CANARY_${suffix}`,
    authorizationUrl: `https://auth.invalid/start?state=AUTH_STATE_CANARY_${suffix}`,
    deviceCode: `DEVICE_CODE_CANARY_${suffix}`,
    promptResponse: `PROMPT_RESPONSE_CANARY_${suffix}`,
    redirectUrl: `http://localhost/callback?code=AUTH_CODE_CANARY_${suffix}&state=ok`,
  };
  const logs = [];
  const events = [];
  const runners = new Map([["runner", { id: "runner", proc: {}, resumeQueue: [] }]]);
  let stored = false;
  const credentialService = {
    async listProviders() {
      return [{
        provider: "mock-oauth", displayName: "Mock OAuth", oauthCapable: true,
        credentialType: stored ? "oauth" : null, source: stored ? "stored_oauth" : "not_configured",
      }];
    },
    async loginOAuth(_provider, callbacks) {
      callbacks.onAuth({ url: secrets.authorizationUrl, instructions: "Authenticate" });
      callbacks.onDeviceCode({ userCode: secrets.deviceCode, verificationUri: "https://auth.invalid/device" });
      const [prompt, redirect] = await Promise.all([
        callbacks.onPrompt({ message: "Tenant" }),
        callbacks.onManualCodeInput(),
      ]);
      assert.equal(prompt, secrets.promptResponse);
      assert.equal(redirect, secrets.redirectUrl);
      writeFileSync(authPath, JSON.stringify({
        "mock-oauth": { type: "oauth", access: secrets.access, refresh: secrets.refresh, expires: Date.now() + 60_000 },
      }), { mode: 0o600 });
      stored = true;
      return { provider: "mock-oauth", credentialType: "oauth" };
    },
    async logoutOAuth(provider) {
      writeFileSync(authPath, "{}", { mode: 0o600 });
      stored = false;
      return { provider, removed: true };
    },
  };
  const restartActiveRunners = async () => {
    events.push({ type: "restart", runnerIds: [...runners.keys()] });
    return { status: "restarted", runnerIds: [...runners.keys()] };
  };
  const registry = new Map();
  const flowService = createPiOAuthFlowService({ registry, credentialService, restartActiveRunners });
  const routes = createOAuthRoutes({ requestContext: context(), credentialService, flowService, restartActiveRunners });

  const started = {};
  await routes["POST /oauth/start"]({ body: { provider: "mock-oauth", replace: false } }, started);
  assert.equal(started.status, 202);
  await settle();
  const flowId = started.body.flow.flowId;
  const active = {};
  await routes["POST /oauth/status"]({ body: { flowId } }, active);
  assert.equal(active.status, 200);
  assert.equal(active.body.flow.authorization.url, secrets.authorizationUrl);
  assert.equal(active.body.flow.deviceCode.userCode, secrets.deviceCode);
  assert.equal(active.body.flow.requests.length, 2);
  assert.doesNotMatch(JSON.stringify(active.body), escaped(secrets.access));
  assert.doesNotMatch(JSON.stringify(active.body), escaped(secrets.refresh));

  const prompt = active.body.flow.requests.find((request) => request.kind === "prompt");
  const manual = active.body.flow.requests.find((request) => request.kind === "manual_code");
  const promptResponse = {};
  await routes["POST /oauth/respond"]({ body: { flowId, requestId: prompt.requestId, value: secrets.promptResponse } }, promptResponse);
  const manualResponse = {};
  await routes["POST /oauth/respond"]({ body: { flowId, requestId: manual.requestId, value: secrets.redirectUrl } }, manualResponse);
  for (const response of [promptResponse, manualResponse]) {
    assert.doesNotMatch(JSON.stringify(response.body), escaped(secrets.promptResponse));
    assert.doesNotMatch(JSON.stringify(response.body), escaped(secrets.redirectUrl));
  }
  await settle();
  const terminal = {};
  await routes["POST /oauth/status"]({ body: { flowId } }, terminal);
  assert.equal(terminal.body.flow.status, "succeeded");
  for (const canary of Object.values(secrets)) assert.doesNotMatch(JSON.stringify(terminal.body), escaped(canary));

  const auth = readFileSync(authPath, "utf8");
  assert.match(auth, escaped(secrets.access));
  assert.match(auth, escaped(secrets.refresh));
  for (const transient of [secrets.authorizationUrl, secrets.deviceCode, secrets.promptResponse, secrets.redirectUrl]) {
    assert.doesNotMatch(auth, escaped(transient));
  }
  assert.equal(statSync(authPath).mode & 0o777, 0o600);
  for (const canary of Object.values(secrets)) {
    assert.equal(sqliteContains(databasePath, canary), false);
    assert.doesNotMatch(JSON.stringify({ logs, events, runners: [...runners.values()] }), escaped(canary));
  }
  const clientFiles = [...filesBelow(join(process.cwd(), "public", "src")), ...filesBelow(join(process.cwd(), "dist"))];
  for (const canary of Object.values(secrets)) {
    assert.equal(clientFiles.some((path) => readFileSync(path).includes(Buffer.from(canary))), false);
  }

  const logout = {};
  await routes["DELETE /oauth"]({ body: { provider: "mock-oauth", restart: true } }, logout);
  assert.equal(logout.status, 200);
  assert.equal(logout.body.upstreamRevoked, false);
  for (const canary of Object.values(secrets)) assert.doesNotMatch(JSON.stringify(logout.body), escaped(canary));
  assert.equal(readFileSync(authPath, "utf8"), "{}");
});
