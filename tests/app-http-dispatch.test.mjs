import test from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "../server/app.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function stableState() {
  const state = {
    config: {
      TOKEN: "dispatch-token",
      PI_DIR: projectRoot,
      DIRNAME: projectRoot,
      PI_BIN: "pi",
      PI_AGENT_DIR: "/tmp/oyster-dispatch-agent",
      PI_EXTRA_ARGS: [],
      TUNNEL_BIN: "cloudflared",
    },
    currentDir: projectRoot,
    tunnels: new Map(),
    sseClients: new Set(),
    reloadCount: 1,
    hublotSupervisor: { async reconcile() { return { checked: 0 }; }, start() {}, stop() {} },
    appStore: {
      path: "/tmp/oyster.sqlite", migrationStatus: { currentVersion: 7, appliedVersions: [1, 2, 3, 4, 5, 6, 7] },
      repositories: {
        sessions: { find: () => null, upsert: (owner) => owner },
        operations: { listIncomplete: () => [] },
        checkpoints: { listForSession: () => [], load: () => ({}), save() {} },
        routines: { list: () => [] },
        hublots: { list: () => [], listProcesses: () => [] },
        pinnedWidgets: { list: () => [], listGroups: () => [] },
        runners: { list: () => [] },
        runnerEvents: { list: () => [] },
      },
      hydrate: () => ({ incompleteOperations: [] }),
    },
    broadcast() {},
    serverEvent() {},
  };
  return state;
}

function request(path, headers = {}, { method = "GET", remoteAddress = "192.0.2.10" } = {}) {
  return {
    method,
    url: path,
    headers: { host: "localhost", ...headers },
    socket: { remoteAddress },
  };
}

function response() {
  return {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = "") { this.body += body; this.writableEnded = true; },
  };
}

test("composed dispatch keeps open routes public and authenticated routes protected", async () => {
  const application = await init(stableState());

  const health = response();
  await application.handleRequest(request("/health"), health);
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).ok, true);

  const unauthorized = response();
  await application.handleRequest(request("/runners"), unauthorized);
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(JSON.parse(unauthorized.body), { error: "unauthorized" });

  const unauthorizedCredentials = response();
  await application.handleRequest(request("/api-keys"), unauthorizedCredentials);
  assert.equal(unauthorizedCredentials.status, 401);
  assert.deepEqual(JSON.parse(unauthorizedCredentials.body), { error: "unauthorized" });

  const unauthorizedSubagent = response();
  await application.handleRequest(request("/subagents", {}, { method: "POST" }), unauthorizedSubagent);
  assert.equal(unauthorizedSubagent.status, 401);
  assert.deepEqual(JSON.parse(unauthorizedSubagent.body), { error: "unauthorized" });

  const oauthRequest = request("/oauth/start");
  oauthRequest.method = "POST";
  const unauthorizedOAuth = response();
  await application.handleRequest(oauthRequest, unauthorizedOAuth);
  assert.equal(unauthorizedOAuth.status, 401);
  assert.deepEqual(JSON.parse(unauthorizedOAuth.body), { error: "unauthorized" });

  const authorized = response();
  await application.handleRequest(request("/runners", { authorization: "Bearer dispatch-token" }), authorized);
  assert.equal(authorized.status, 200);
  assert.deepEqual(JSON.parse(authorized.body), { runners: [] });
});

test("loopback routine and hublot requests require explicit authentication", async () => {
  const application = await init(stableState());
  for (const path of ["/routines", "/tunnels"]) {
    const local = response();
    await application.handleRequest(request(path, {}, { remoteAddress: "127.0.0.1" }), local);
    assert.equal(local.status, 401, `${path} must not trust loopback`);

    const queryMutation = response();
    await application.handleRequest(request(`${path}?token=dispatch-token`, {}, {
      method: "POST", remoteAddress: "::ffff:127.0.0.1",
    }), queryMutation);
    assert.equal(queryMutation.status, 401, `${path} mutations must not accept URL credentials`);

    const bearer = response();
    await application.handleRequest(request(path, { authorization: "Bearer dispatch-token" }, {
      remoteAddress: "127.0.0.1",
    }), bearer);
    assert.equal(bearer.status, 200, `${path} must accept Bearer authentication`);
  }
});

test("composed dispatch bypasses token checks only when the Oyster instance is explicitly unauthenticated", async () => {
  const state = stableState();
  state.config.UNAUTHENTICATED = true;
  const application = await init(state);

  const runners = response();
  await application.handleRequest(request("/runners"), runners);
  assert.equal(runners.status, 200);
  assert.deepEqual(JSON.parse(runners.body), { runners: [] });

  const credentials = response();
  await application.handleRequest(request("/api-keys"), credentials);
  assert.notEqual(credentials.status, 401);
});

test("dispatch rejects malformed request targets and does not parse the untrusted Host header", async () => {
  const application = await init(stableState());

  const malformed = response();
  await application.handleRequest(request("http://["), malformed);
  assert.equal(malformed.status, 400);
  assert.deepEqual(JSON.parse(malformed.body), { error: "invalid request URL" });

  const invalidHost = response();
  await application.handleRequest(request("/health", { host: "[" }), invalidHost);
  assert.equal(invalidHost.status, 200);

  const wrongMethod = response();
  await application.handleRequest(request("/health", { authorization: "Bearer dispatch-token" }, { method: "POST" }), wrongMethod);
  assert.equal(wrongMethod.status, 405);
  assert.deepEqual(JSON.parse(wrongMethod.body), { error: "method not allowed" });
});
