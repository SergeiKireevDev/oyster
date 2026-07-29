import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOysterHub } from "../oyster-hub/app.mjs";
import { loadConfig, validateConfig } from "../oyster-hub/config.mjs";
import { deriveWorkspaceToken } from "../oyster-hub/drivers/llmbox.mjs";
import { createWorkspaceDriver } from "../oyster-hub/drivers/index.mjs";
import { createMockWorkspaceDriver } from "../oyster-hub/drivers/mock.mjs";
import { parseScopedValue, scopePinnedWidget, scopePinnedWidgetGroup } from "../oyster-hub/ui-gateway.mjs";

test("Hub scopes pinned widget, group, hublot, and session identities to one workspace", () => {
  const workspace = { id: "box-a", name: "Box A", environmentId: "local" };
  const group = scopePinnedWidgetGroup(workspace, { id: "g1", name: "Media", sessionId: "s1" });
  const widget = scopePinnedWidget(workspace, { id: "w1", label: "Clip", groupId: "g1", hublotId: "h1", sessionId: "s1" });
  assert.deepEqual(parseScopedValue(group.id), { workspaceId: "box-a", kind: "pinned-widget-group", value: "g1" });
  assert.deepEqual(parseScopedValue(widget.id), { workspaceId: "box-a", kind: "pinned-widget", value: "w1" });
  assert.deepEqual(parseScopedValue(widget.groupId), { workspaceId: "box-a", kind: "pinned-widget-group", value: "g1" });
  assert.deepEqual(parseScopedValue(widget.hublotId), { workspaceId: "box-a", kind: "hublot", value: "h1" });
  assert.deepEqual(parseScopedValue(widget.sessionId), { workspaceId: "box-a", kind: "session-id", value: "s1" });
});

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function close(server) {
  server.close();
  await once(server, "close");
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

async function requestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
}

async function requestBytes(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function streamingRequest(target, { method = "POST", headers = {} } = {}) {
  const url = new URL(target);
  let request;
  const response = new Promise((resolvePromise, reject) => {
    request = httpRequest(url, { method, headers }, (res) => {
      requestBytes(res).then((body) => resolvePromise({ res, body }), reject);
    });
    request.on("error", reject);
  });
  return { request, response };
}

function fakeWorkspace({ unauthenticated = false } = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://workspace.test");
    if (url.pathname === "/health") return sendJson(res, 200, { ok: true, runners: [] });
    if (!unauthenticated && req.headers.authorization !== `Bearer ${deriveWorkspaceToken("workspace-token-secret", "local")}`
      && req.headers.authorization !== `Bearer ${deriveWorkspaceToken("workspace-token-secret", "created")}`) {
      return sendJson(res, 401, { error: "bad workspace token" });
    }
    if (url.pathname === "/runners") return sendJson(res, 200, { runners: [{ id: "one", alive: true, busy: true }, { id: "two", alive: false, busy: false }] });
    if (url.pathname === "/sessions") return sendJson(res, 200, { sessions: [{ id: "s1" }, { id: "s2" }, { id: "s3" }] });
    if (url.pathname === "/routines") return sendJson(res, 200, { routines: [{ name: "build", status: "running" }] });
    if (url.pathname === "/tunnels") return sendJson(res, 200, { tunnels: [{ id: "h1", status: "open", publicUrl: "https://example.test" }] });
    if (url.pathname === "/rpc" && req.method === "POST") {
      return sendJson(res, 202, { query: url.searchParams.get("runner"), body: await requestJson(req) });
    }
    if (url.pathname === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.flushHeaders();
      return setTimeout(() => res.end("data: late-event\n\n"), 150);
    }
    sendJson(res, 404, { error: "missing" });
  });
}

function fakeLlmbox(workspaceUrl) {
  const calls = [];
  const boxes = [{
    instance_id: "instance-local",
    box_id: "local",
    description: "Local",
    spoke: "edge-1",
    state: "running",
    status: "Up",
    created: 1_700_000_000,
  }];
  const proxies = [{ box_id: "local", port: 8080, url: workspaceUrl, slug: "local-oyster" }];
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer llmbox-secret") return sendJson(res, 401, { error: "bad llmbox key" });
    const url = new URL(req.url, "http://llmbox.test");
    const body = await requestJson(req);
    calls.push({ path: url.pathname, body });
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST required" });
    if (url.pathname === "/api/v1/spoke-statuses") return sendJson(res, 200, { spokes: [{ name: "edge-1", connected: true, default: true }] });
    if (url.pathname === "/api/v1/list-boxes") return sendJson(res, 200, { boxes });
    if (url.pathname === "/api/v1/list-proxies") return sendJson(res, 200, { proxies });
    if (url.pathname === "/api/v1/create-box") {
      const opts = body.opts;
      if (boxes.some((box) => box.box_id === opts.BoxID)) return sendJson(res, 500, { error: "duplicate box" });
      boxes.push({ instance_id: `instance-${opts.BoxID}`, box_id: opts.BoxID, description: opts.Description, spoke: opts.SpokeName, state: "running", status: "Up", created: 1_700_000_001 });
      return sendJson(res, 200, { session: { BoxID: opts.BoxID, Generation: `instance-${opts.BoxID}`, Description: opts.Description } });
    }
    if (url.pathname === "/api/v1/create-proxy") {
      const proxy = { box_id: body.box_id, port: body.port, url: workspaceUrl, slug: `${body.box_id}-oyster` };
      proxies.push(proxy);
      return sendJson(res, 200, { proxy });
    }
    if (url.pathname === "/api/v1/pause-box" || url.pathname === "/api/v1/resume-box") {
      const box = boxes.find((candidate) => candidate.box_id === body.box_id);
      if (!box) return sendJson(res, 404, { error: "box not found" });
      box.state = url.pathname.endsWith("pause-box") ? "paused" : "running";
      box.status = box.state === "paused" ? "Paused" : "Up";
      return sendJson(res, 200, {});
    }
    if (url.pathname === "/api/v1/destroy-box") {
      const index = boxes.findIndex((candidate) => candidate.box_id === body.box_id);
      if (index >= 0) boxes.splice(index, 1);
      for (let proxyIndex = proxies.length - 1; proxyIndex >= 0; proxyIndex -= 1) {
        if (proxies[proxyIndex].box_id === body.box_id) proxies.splice(proxyIndex, 1);
      }
      return sendJson(res, 200, {});
    }
    sendJson(res, 404, { error: "missing llmbox operation" });
  });
  return { server, calls, boxes, proxies };
}

function mockHubConfig(workspaceUrl, timeoutMs = 1000) {
  return validateConfig({
    port: 8082,
    token: "hub-secret",
    timeoutMs,
    driver: { type: "mock", endpoint: workspaceUrl, id: "local", name: "Local Oyster" },
  }, {});
}

function hubConfig(llmboxUrl, timeoutMs = 1000) {
  return validateConfig({
    token: "hub-secret",
    timeoutMs,
    driver: {
      type: "llmbox",
      endpoint: llmboxUrl,
      token: "llmbox-secret",
      tokenSecret: "workspace-token-secret",
      workspacePort: 8080,
      tokenFile: { path: "/run/secrets/oyster-ui-token", mode: 384, uid: 1000, gid: 1000 },
    },
  }, {});
}

async function fleet(t, timeoutMs = 1000) {
  const upstream = fakeWorkspace();
  const upstreamUrl = await listen(upstream);
  t.after(() => close(upstream));
  const llmbox = fakeLlmbox(upstreamUrl);
  const llmboxUrl = await listen(llmbox.server);
  t.after(() => close(llmbox.server));
  const hub = createOysterHub(hubConfig(llmboxUrl, timeoutMs), { logger: { error() {} } });
  const hubUrl = await listen(hub);
  t.after(() => close(hub));
  return { hubUrl, llmbox, upstreamUrl };
}

test("oyster hub validates configurable llmbox and mock drivers", () => {
  assert.throws(() => validateConfig({ token: "x" }, {}), /driver must be an object/);
  assert.throws(() => validateConfig({ token: "x", driver: { type: "other" } }, {}), /unsupported workspace driver/);
  assert.throws(() => validateConfig({ token: "x", uploadIdleTimeoutMs: 99, driver: { type: "mock" } }, {}), /uploadIdleTimeoutMs/);
  assert.throws(() => validateConfig({ token: "x", uploadResponseTimeoutMs: 30 * 60 * 1000 + 1, driver: { type: "mock" } }, {}), /uploadResponseTimeoutMs/);
  assert.throws(() => validateConfig({ token: "x", maxConcurrentUploads: 0, driver: { type: "mock" } }, {}), /maxConcurrentUploads/);
  assert.throws(() => validateConfig({ token: "x", cloud: { boxConnectUrl: "ws://hub.example/box/connect" }, driver: { type: "mock" } }, {}), /must use wss/);
  assert.throws(() => validateConfig({ token: "x", driver: {
    type: "llmbox", endpoint: "file:///tmp/box", token: "key", tokenSecret: "secret",
  } }, {}), /must use http or https/);
  assert.throws(() => validateConfig({ token: "x", driver: {
    type: "llmbox", endpoint: "http://localhost", token: "key", tokenSecret: "secret", workspacePort: 70000,
  } }, {}), /workspacePort/);
  assert.throws(() => validateConfig({ token: "x", driver: {
    type: "llmbox", transport: "pipe", tokenSecret: "secret",
  } }, {}), /transport must be http or native/);
  assert.throws(() => validateConfig({ token: "x", driver: {
    type: "llmbox", transport: "native", tokenSecret: "secret", createTimeoutMs: 31 * 60 * 1000,
  } }, {}), /createTimeoutMs/);
  const native = validateConfig({ token: "x", driver: {
    type: "llmbox", transport: "native", tokenSecret: "secret",
    binding: { addonPath: "build/llmbox.node", configPath: "llmbox.yaml" },
  } }, {});
  assert.equal(native.driver.endpoint, "native://embedded-llmbox");
  assert.equal(native.driver.transport, "native");
  assert.equal(native.driver.createTimeoutMs, 6 * 60 * 1000);
  assert.match(native.driver.binding.addonPath, /build\/llmbox\.node$/);
  assert.match(native.driver.binding.configPath, /llmbox\.yaml$/);
  assert.equal("token" in native.driver, false);

  const composite = validateConfig({ token: "x", drivers: [
    { type: "mock", endpoint: "http://localhost:8080", id: "local", name: "Local Oyster", token: "local-token" },
    { type: "llmbox", endpoint: "http://localhost:8081", token: "llmbox-key", tokenSecret: "secret" },
  ] }, {});
  assert.equal(composite.driver.type, "composite");
  assert.deepEqual(composite.driver.drivers.map(({ type }) => type), ["mock", "llmbox"]);
  assert.throws(() => validateConfig({ token: "x", driver: { type: "mock" }, drivers: [{ type: "mock" }, { type: "mock" }] }, {}), /either driver or drivers/);
  assert.throws(() => validateConfig({ token: "x", drivers: [{ type: "mock" }] }, {}), /at least two/);

  assert.throws(() => validateConfig({ token: "x", cloud: { repository: "http://example.com/oyster.git" }, driver: { type: "mock" } }, {}), /must use https/);
  assert.throws(() => validateConfig({ token: "x", cloud: { oauth: { gcp: { clientId: "only-id" } } }, driver: { type: "mock" } }, {}), /both clientId and clientSecret/);
  const oauthConfig = validateConfig({ token: "x", cloud: { publicUrl: "https://hub.example" }, driver: { type: "mock" } }, {
    OYSTER_HUB_GOOGLE_OAUTH_CLIENT_ID: "google-id",
    OYSTER_HUB_GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
    OYSTER_HUB_CLOUD_CREDENTIAL_KEY: "vault-key",
  });
  assert.equal(oauthConfig.cloud.oauth.gcp.redirectUrl, "https://hub.example/cloud/oauth/gcp/callback");
  assert.equal(oauthConfig.cloud.credentialEncryptionKey, "vault-key");

  const mock = validateConfig({ token: "x", port: 8082, driver: { type: "mock" } }, {});
  assert.equal(mock.port, 8082);
  assert.equal(mock.uploadIdleTimeoutMs, 30000);
  assert.equal(mock.uploadResponseTimeoutMs, 30000);
  assert.equal(mock.maxConcurrentUploads, 16);
  assert.equal(mock.cloud.boxConnectUrl, "wss://hub.get-oyster.dev/box/connect");
  assert.equal(mock.cloud.repository, "https://github.com/SergeiKireevDev/oyster.git");
  assert.equal(mock.cloud.ref, "main");
  assert.deepEqual(mock.driver, {
    type: "mock", endpoint: "http://localhost:8080",
    environmentId: "local", environmentName: "Local",
    id: "local", name: "Local Oyster", token: null,
  });

  const multiple = validateConfig({ token: "x", driver: { type: "mock", workspaces: [
    { id: "one", name: "One", endpoint: "http://localhost:8080" },
    { id: "two", name: "Two", endpoint: "http://localhost:8083" },
  ] } }, {});
  assert.deepEqual(multiple.driver, {
    type: "mock",
    endpoint: "multiple",
    workspaces: [
      { environmentId: "local", environmentName: "Local", id: "one", name: "One", endpoint: "http://localhost:8080", token: null },
      { environmentId: "local", environmentName: "Local", id: "two", name: "Two", endpoint: "http://localhost:8083", token: null },
    ],
  });
  assert.throws(() => validateConfig({ token: "x", driver: { type: "mock", workspaces: [
    { id: "same", endpoint: "http://localhost:8080" }, { id: "same", endpoint: "http://localhost:8083" },
  ] } }, {}), /ids must be unique/);
});

test("mock Hub config can share one token file with every workspace", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-hub-shared-token-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tokenPath = join(root, "ui-token");
  const configPath = join(root, "config.json");
  writeFileSync(tokenPath, "shared-secret\n");
  writeFileSync(configPath, JSON.stringify({
    token: "config-fallback",
    sharedTokenFile: tokenPath,
    driver: { type: "mock", workspaces: [
      { id: "one", endpoint: "http://localhost:8080" },
      { id: "two", endpoint: "http://localhost:8083", token: "workspace-fallback" },
    ] },
  }));

  const { config } = await loadConfig(["--config", configPath], {});
  assert.equal(config.token, "shared-secret");
  assert.deepEqual(config.driver.workspaces.map((workspace) => workspace.token), ["shared-secret", "shared-secret"]);
});

test("mock driver lists every configured local Oyster workspace", async () => {
  const driver = createMockWorkspaceDriver({ endpoint: "multiple", workspaces: [
    { id: "one", name: "One", endpoint: "http://localhost:8080", token: "shared" },
    { id: "two", name: "Two", endpoint: "http://localhost:8083", token: "shared" },
  ] });
  assert.deepEqual((await driver.listWorkspaces()).map(({ id, url }) => [id, url]), [
    ["one", "http://localhost:8080"], ["two", "http://localhost:8083"],
  ]);
  assert.equal((await driver.getWorkspace("two")).name, "Two");
  assert.equal(await driver.getWorkspace("missing"), null);
});

test("composite driver exposes configured local and llmbox environments together", async (t) => {
  const upstream = fakeWorkspace({ unauthenticated: true });
  const upstreamUrl = await listen(upstream);
  t.after(() => close(upstream));
  const llmbox = fakeLlmbox(upstreamUrl);
  const llmboxUrl = await listen(llmbox.server);
  t.after(() => close(llmbox.server));
  const config = validateConfig({ token: "hub-secret", drivers: [
    { type: "mock", endpoint: upstreamUrl, environmentId: "local", environmentName: "Local", id: "direct", name: "Direct Oyster" },
    { type: "llmbox", endpoint: llmboxUrl, token: "llmbox-secret", tokenSecret: "workspace-token-secret" },
  ] }, {});
  const driver = createWorkspaceDriver(config.driver);

  assert.deepEqual((await driver.listEnvironments()).map(({ id, kind }) => [id, kind]), [["local", "local"], ["edge-1", "llmbox"]]);
  assert.deepEqual((await driver.listWorkspaces()).map(({ id, environmentId }) => [id, environmentId]), [["direct", "local"], ["local", "edge-1"]]);
  assert.equal((await driver.getWorkspace("direct")).name, "Direct Oyster");
  assert.equal((await driver.getWorkspace("local")).provider.type, "llmbox");
  assert.equal(driver.capabilities.create, true);
  assert.equal(driver.capabilities.remove, true);
  assert.equal((await driver.pauseWorkspace("local")).status, "paused");
  assert.equal((await driver.getWorkspace("local")).status, "paused");
  assert.equal((await driver.resumeWorkspace("local")).status, "online");

  const hub = createOysterHub(config, { driver, logger: { error() {} } });
  const hubUrl = await listen(hub);
  t.after(() => close(hub));
  const destroyed = await fetch(`${hubUrl}/api/v1/workspaces/local`, {
    method: "DELETE", headers: { authorization: "Bearer hub-secret" },
  });
  assert.equal(destroyed.status, 200);
  assert.deepEqual(await destroyed.json(), { workspace: { id: "local", destroyed: true } });
  assert.equal(await driver.getWorkspace("local"), null);
});

test("mock driver exposes one local read-only workspace through a hub on port 8082", async (t) => {
  const upstream = fakeWorkspace({ unauthenticated: true });
  const upstreamUrl = await listen(upstream);
  t.after(() => close(upstream));
  const config = mockHubConfig(upstreamUrl);
  assert.equal(config.port, 8082);
  const hub = createOysterHub(config, { logger: { error() {} } });
  const hubUrl = await listen(hub);
  t.after(() => close(hub));

  const overviewResponse = await fetch(`${hubUrl}/api/v1/overview`, {
    headers: { authorization: "Bearer hub-secret" },
  });
  assert.equal(overviewResponse.status, 200);
  const overview = await overviewResponse.json();
  assert.deepEqual(overview.driver, {
    type: "mock",
    endpoint: upstreamUrl,
    capabilities: { list: true, create: false, remove: false },
  });
  assert.equal(overview.workspaces.length, 1);
  assert.equal(overview.workspaces[0].id, "local");
  assert.equal(overview.workspaces[0].url, upstreamUrl);
  assert.equal(overview.workspaces[0].status, "online");
  const environmentResponse = await fetch(`${hubUrl}/api/v1/environments`, {
    headers: { authorization: "Bearer hub-secret" },
  });
  assert.equal(environmentResponse.status, 200);
  assert.deepEqual((await environmentResponse.json()).environments, [
    { id: "local", name: "Local", kind: "local", status: "online", local: true },
  ]);

  const create = await fetch(`${hubUrl}/api/v1/workspaces`, {
    method: "POST",
    headers: { authorization: "Bearer hub-secret", "content-type": "application/json" },
    body: JSON.stringify({ id: "forbidden" }),
  });
  assert.equal(create.status, 405);
  assert.deepEqual(await create.json(), { error: "mock workspace driver cannot create workspaces" });

  const remove = await fetch(`${hubUrl}/api/v1/workspaces/local`, {
    method: "DELETE",
    headers: { authorization: "Bearer hub-secret" },
  });
  assert.equal(remove.status, 405);
  assert.deepEqual(await remove.json(), { error: "mock workspace driver cannot remove workspaces" });
});

test("Hub preserves an initializing workspace status while its Oyster endpoint starts", async (t) => {
  const workspace = {
    environmentId: "cloud-1",
    environmentName: "Cloud 1",
    id: "cloud-1",
    name: "Cloud 1",
    url: "http://127.0.0.1:1",
    status: "initializing",
    provider: { type: "cloud", phase: "initializing" },
  };
  const driver = {
    type: "test", endpoint: "memory://test", capabilities: { list: true, create: false, remove: false },
    async listEnvironments() { return []; },
    async listWorkspaces() { return [workspace]; },
    async getWorkspace(id) { return id === workspace.id ? workspace : null; },
  };
  const cloudService = { async listEnvironments() { return []; }, async listWorkspaces() { return []; } };
  const hubServer = createOysterHub(mockHubConfig("http://127.0.0.1:1", 100), { driver, cloudService, logger: { error() {} } });
  const hubUrl = await listen(hubServer);
  t.after(() => close(hubServer));

  const response = await fetch(`${hubUrl}/api/v1/workspaces`, { headers: { authorization: "Bearer hub-secret" } });
  assert.equal(response.status, 200);
  const [listed] = (await response.json()).workspaces;
  assert.equal(listed.status, "initializing");
  assert.match(listed.errors.health, /fetch failed|ECONNREFUSED/);
});

test("fast workspace discovery skips health probes and shares driver discovery with UI routing", async (t) => {
  let upstreamCalls = 0;
  const upstream = createServer((req, res) => {
    upstreamCalls++;
    if (new URL(req.url, "http://workspace.test").pathname === "/runners") return sendJson(res, 200, { runners: [] });
    sendJson(res, 500, { error: "health probing is not expected" });
  });
  const upstreamUrl = await listen(upstream);
  t.after(() => close(upstream));
  let discoveryCalls = 0;
  const workspace = { environmentId: "local", environmentName: "Local", id: "local", name: "Local", url: upstreamUrl, provider: { state: "running", phase: "running" } };
  const driver = {
    type: "test", endpoint: "memory://test", capabilities: { list: true, create: false, remove: false },
    async listWorkspaces() { discoveryCalls++; return [workspace]; },
    async getWorkspace(id) { return id === workspace.id ? workspace : null; },
  };
  const cloudService = { async listEnvironments() { return []; }, async listWorkspaces() { return []; } };
  const hub = createOysterHub(mockHubConfig(upstreamUrl), { driver, cloudService, logger: { error() {} } });
  const hubUrl = await listen(hub);
  t.after(() => close(hub));
  const headers = { "x-auth-token": "hub-secret" };

  const discovery = await fetch(`${hubUrl}/api/v1/workspaces?probe=0`, { headers });
  assert.equal(discovery.status, 200);
  assert.equal((await discovery.json()).workspaces[0].status, "online");
  assert.equal(upstreamCalls, 0, "fast discovery must not contact the Oyster endpoint");

  const runners = await fetch(`${hubUrl}/runners`, { headers: { ...headers, "x-oyster-workspace": "local" } });
  assert.equal(runners.status, 200);
  assert.equal(discoveryCalls, 1, "the following UI route reuses the same discovery result");
  assert.equal(upstreamCalls, 1);
});

test("llmbox workspace tokens are stable, scoped, and derived from the configured secret", () => {
  assert.equal(deriveWorkspaceToken("secret", "alpha"), deriveWorkspaceToken("secret", "alpha"));
  assert.notEqual(deriveWorkspaceToken("secret", "alpha"), deriveWorkspaceToken("secret", "beta"));
  assert.notEqual(deriveWorkspaceToken("secret", "alpha"), deriveWorkspaceToken("other", "alpha"));
});

test("oyster hub discovers llmbox boxes and aggregates their Oyster results", async (t) => {
  const { hubUrl } = await fleet(t);
  const denied = await fetch(`${hubUrl}/api/v1/overview`);
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: "unauthorized for GET /api/v1/overview" });

  const response = await fetch(`${hubUrl}/api/v1/overview`, { headers: { authorization: "Bearer hub-secret" } });
  assert.equal(response.status, 200);
  const overview = await response.json();
  assert.deepEqual(overview.driver, {
    type: "llmbox",
    endpoint: overview.driver.endpoint,
    capabilities: { list: true, create: true, remove: true },
  });
  assert.deepEqual(overview.totals, {
    workspaces: 1, online: 1, offline: 0, provisioning: 0,
    runners: 2, runningRunners: 1, busyRunners: 1,
    sessions: 3, routines: 1, runningRoutines: 1,
    hublots: 1, openHublots: 1,
  });
  assert.equal(overview.workspaces[0].environmentId, "edge-1");
  assert.equal(overview.workspaces[0].environmentName, "edge-1");
  assert.equal(overview.workspaces[0].id, "local");
  assert.equal(overview.workspaces[0].provider.type, "llmbox");
  const environmentResponse = await fetch(`${hubUrl}/api/v1/environments`, {
    headers: { authorization: "Bearer hub-secret" },
  });
  assert.deepEqual((await environmentResponse.json()).environments, [
    { id: "edge-1", name: "edge-1", kind: "llmbox", status: "online", default: true, spoke: "edge-1" },
  ]);
  assert.equal(JSON.stringify(overview).includes("llmbox-secret"), false);
  assert.equal(JSON.stringify(overview).includes("workspace-token-secret"), false);
});

test("POST workspaces creates an llmbox box, injects its Oyster token, and exposes its port", async (t) => {
  const { hubUrl, llmbox } = await fleet(t);
  const response = await fetch(`${hubUrl}/api/v1/workspaces`, {
    method: "POST",
    headers: { authorization: "Bearer hub-secret", "content-type": "application/json" },
    body: JSON.stringify({ id: "created", name: "Created workspace", spoke: "edge-2", diskBytes: 20 * 1024 ** 3 }),
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.workspace.environmentId, "edge-2");
  assert.equal(result.workspace.id, "created");
  assert.equal(result.workspace.url, llmbox.proxies.at(-1).url.replace(/\/$/, ""));
  assert.equal(JSON.stringify(result).includes(deriveWorkspaceToken("workspace-token-secret", "created")), false);

  const create = llmbox.calls.find((call) => call.path === "/api/v1/create-box");
  assert.equal(create.body.opts.BoxID, "created");
  assert.equal(create.body.opts.SpokeName, "edge-2");
  assert.equal(create.body.opts.DiskBytes, 20 * 1024 ** 3);
  assert.deepEqual(create.body.opts.Files[0], {
    Path: "/run/secrets/oyster-ui-token",
    Content: Buffer.from(`${deriveWorkspaceToken("workspace-token-secret", "created")}\n`).toString("base64"),
    Mode: 384,
    UID: 1000,
    GID: 1000,
  });
  assert.deepEqual(llmbox.calls.find((call) => call.path === "/api/v1/create-proxy").body, {
    box_id: "created", port: 8080, description: "Oyster workspace",
  });
});

test("llmbox workspaces can be paused, resumed, and destroyed through Hub lifecycle routes", async (t) => {
  const { hubUrl, llmbox } = await fleet(t);
  const headers = { authorization: "Bearer hub-secret", "content-type": "application/json" };

  const pause = await fetch(`${hubUrl}/api/v1/workspaces/local/actions`, {
    method: "POST", headers, body: JSON.stringify({ action: "pause" }),
  });
  assert.equal(pause.status, 200);
  assert.deepEqual(await pause.json(), { workspace: { id: "local", status: "paused" } });

  const pausedList = await fetch(`${hubUrl}/api/v1/workspaces?probe=0`, { headers });
  assert.equal((await pausedList.json()).workspaces[0].status, "paused");

  const resume = await fetch(`${hubUrl}/api/v1/workspaces/local/actions`, {
    method: "POST", headers, body: JSON.stringify({ action: "resume" }),
  });
  assert.equal(resume.status, 200);
  assert.deepEqual(await resume.json(), { workspace: { id: "local", status: "online" } });

  const destroy = await fetch(`${hubUrl}/api/v1/workspaces/local`, { method: "DELETE", headers });
  assert.equal(destroy.status, 200);
  assert.deepEqual(await destroy.json(), { workspace: { id: "local", destroyed: true } });
  assert.equal(llmbox.boxes.some((box) => box.box_id === "local"), false);
  assert.deepEqual(llmbox.calls.filter((call) => /\/(pause|resume|destroy)-box$/.test(call.path)).map((call) => [call.path, call.body]), [
    ["/api/v1/pause-box", { box_id: "local" }],
    ["/api/v1/resume-box", { box_id: "local" }],
    ["/api/v1/destroy-box", { box_id: "local" }],
  ]);
});

test("workspace-scoped API resolves through the driver and proxies the request", async (t) => {
  const { hubUrl } = await fleet(t);
  const response = await fetch(`${hubUrl}/api/v1/workspaces/local/rpc?runner=abc`, {
    method: "POST",
    headers: { authorization: "Bearer hub-secret", "content-type": "application/json" },
    body: JSON.stringify({ type: "get_state" }),
  });
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("x-oyster-workspace"), "local");
  assert.deepEqual(await response.json(), { query: "abc", body: { type: "get_state" } });

  const missing = await fetch(`${hubUrl}/api/v1/workspaces/unknown/runners`, { headers: { "x-api-key": "hub-secret" } });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "workspace not found", workspace: "unknown" });

  const schema = await fetch(`${hubUrl}/api/v1/openapi.json`, { headers: { "x-auth-token": "hub-secret" } });
  assert.equal(schema.status, 200);
  assert.equal((await schema.json()).openapi, "3.1.0");
});

test("workspace uploads stream before the browser finishes and outlive the normal request timeout", async (t) => {
  let firstDataResolve;
  const firstData = new Promise((resolvePromise) => { firstDataResolve = resolvePromise; });
  const observed = { chunks: [], headers: null, query: null };
  const upstream = createServer(async (req, res) => {
    const url = new URL(req.url, "http://workspace.test");
    observed.headers = req.headers;
    observed.query = Object.fromEntries(url.searchParams);
    for await (const chunk of req) {
      observed.chunks.push(chunk);
      firstDataResolve();
    }
    sendJson(res, 200, { received: Buffer.concat(observed.chunks).length });
  });
  const upstreamUrl = await listen(upstream);
  t.after(() => close(upstream));
  const workspace = { id: "alpha", name: "Alpha", url: upstreamUrl, token: "workspace-secret" };
  const driver = {
    type: "test", endpoint: "memory://test", capabilities: { list: true },
    async listWorkspaces() { return [workspace]; },
    async getWorkspace(id) { return id === workspace.id ? workspace : null; },
  };
  const config = validateConfig({
    token: "hub-secret",
    timeoutMs: 100,
    uploadIdleTimeoutMs: 250,
    uploadResponseTimeoutMs: 250,
    driver: { type: "mock", endpoint: upstreamUrl },
  }, {});
  const transfers = [];
  const hub = createOysterHub(config, { driver, logger: { error() {} }, onTransfer: (event) => transfers.push(event) });
  const hubUrl = await listen(hub);
  t.after(() => close(hub));

  const chunks = [Buffer.alloc(64 * 1024, 1), Buffer.alloc(64 * 1024, 2), Buffer.alloc(64 * 1024, 3)];
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const { request, response } = streamingRequest(`${hubUrl}/file-upload?workspace=alpha&dir=%2Ftmp&name=data.bin&offset=0&last=1&token=remove-me`, {
    headers: {
      "x-auth-token": "hub-secret",
      "content-type": "application/octet-stream",
      "content-length": String(total),
    },
  });
  request.write(chunks[0]);
  await firstData;
  assert.equal(request.writableEnded, false, "upstream receives bytes before the browser request ends");
  await wait(70);
  request.write(chunks[1]);
  await wait(70);
  request.end(chunks[2]);
  const result = await response;

  assert.equal(result.res.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { received: total });
  assert.deepEqual(Buffer.concat(observed.chunks), Buffer.concat(chunks));
  assert.equal(observed.headers.authorization, "Bearer workspace-secret");
  assert.equal(observed.headers["x-auth-token"], undefined);
  assert.equal(observed.headers["content-length"], String(total));
  assert.deepEqual(observed.query, { dir: "/tmp", name: "data.bin", offset: "0", last: "1" });
  assert.deepEqual(transfers.map(({ workspaceId, uploadedBytes, closeReason }) => ({ workspaceId, uploadedBytes, closeReason })), [
    { workspaceId: "alpha", uploadedBytes: total, closeReason: "complete" },
  ]);
  assert.ok(transfers[0].durationMs >= 100, "progressing upload lasted longer than the normal request timeout");
});

test("workspace upload idle timeout aborts a stalled stream with an actionable error", async (t) => {
  const upstream = createServer(async (req, res) => {
    try { for await (const _chunk of req) {} } catch {}
    if (!res.headersSent) sendJson(res, 200, { unexpected: true });
  });
  const upstreamUrl = await listen(upstream);
  t.after(() => close(upstream));
  const workspace = { id: "alpha", name: "Alpha", url: upstreamUrl, token: null };
  const driver = {
    type: "test", endpoint: "memory://test", capabilities: { list: true },
    async listWorkspaces() { return [workspace]; },
    async getWorkspace(id) { return id === workspace.id ? workspace : null; },
  };
  const config = validateConfig({
    token: "hub-secret", timeoutMs: 1000, uploadIdleTimeoutMs: 100, uploadResponseTimeoutMs: 100,
    driver: { type: "mock", endpoint: upstreamUrl },
  }, {});
  const hub = createOysterHub(config, { driver, logger: { error() {} } });
  const hubUrl = await listen(hub);
  t.after(() => close(hub));

  const { request, response } = streamingRequest(`${hubUrl}/file-upload?workspace=alpha&dir=%2Ftmp&name=stalled.bin&offset=0&last=1`, {
    headers: { "x-auth-token": "hub-secret", "content-type": "application/octet-stream", "content-length": "2" },
  });
  request.write(Buffer.from("a"));
  const result = await response;
  request.destroy();
  assert.equal(result.res.statusCode, 502);
  assert.deepEqual(JSON.parse(result.body), {
    error: "workspace request failed",
    workspace: "alpha",
    detail: "workspace upload idle for 100ms",
  });
});

test("workspace upload offsets recover from 409 and finalize through the Hub", async (t) => {
  let stored = Buffer.alloc(0);
  const upstream = createServer(async (req, res) => {
    const url = new URL(req.url, "http://workspace.test");
    const offset = Number(url.searchParams.get("offset"));
    const last = url.searchParams.get("last") === "1";
    const body = await requestBytes(req);
    if (offset !== stored.length) return sendJson(res, 409, { error: "chunk out of sequence", have: stored.length });
    stored = Buffer.concat([stored, body]);
    return sendJson(res, 200, last ? { saved: "/tmp/chunked.bin", bytes: stored.length } : { received: stored.length });
  });
  const upstreamUrl = await listen(upstream);
  t.after(() => close(upstream));
  const workspace = { id: "alpha", name: "Alpha", url: upstreamUrl, token: null };
  const driver = {
    type: "test", endpoint: "memory://test", capabilities: { list: true },
    async listWorkspaces() { return [workspace]; },
    async getWorkspace(id) { return id === workspace.id ? workspace : null; },
  };
  const hub = createOysterHub(mockHubConfig(upstreamUrl), { driver, logger: { error() {} } });
  const hubUrl = await listen(hub);
  t.after(() => close(hub));
  const headers = { "x-auth-token": "hub-secret", "content-type": "application/octet-stream" };
  const upload = (offset, last, body) => fetch(`${hubUrl}/file-upload?workspace=alpha&dir=%2Ftmp&name=chunked.bin&offset=${offset}&last=${last ? 1 : 0}`, {
    method: "POST", headers, body,
  });

  const first = await upload(0, false, "abc");
  assert.deepEqual(await first.json(), { received: 3 });
  const conflict = await upload(1, true, "def");
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).have, 3);
  const final = await upload(3, true, "def");
  assert.deepEqual(await final.json(), { saved: "/tmp/chunked.bin", bytes: 6 });
  assert.equal(stored.toString(), "abcdef");
});

test("lost upload responses remain safe to retry through the Hub", async (t) => {
  let applied = null;
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    const body = await requestBytes(req);
    calls += 1;
    if (applied == null) applied = Buffer.from(body);
    else assert.deepEqual(body, applied, "retry carries the identical offset body");
    if (calls === 1) {
      req.socket.destroy();
      return;
    }
    sendJson(res, 200, { saved: "/tmp/retried.bin", bytes: applied.length });
  });
  const upstreamUrl = await listen(upstream);
  t.after(() => close(upstream));
  const workspace = { id: "alpha", name: "Alpha", url: upstreamUrl, token: null };
  const driver = {
    type: "test", endpoint: "memory://test", capabilities: { list: true },
    async listWorkspaces() { return [workspace]; },
    async getWorkspace(id) { return id === workspace.id ? workspace : null; },
  };
  const hub = createOysterHub(mockHubConfig(upstreamUrl), { driver, logger: { error() {} } });
  const hubUrl = await listen(hub);
  t.after(() => close(hub));
  const target = `${hubUrl}/file-upload?workspace=alpha&dir=%2Ftmp&name=retried.bin&offset=0&last=1`;
  const options = {
    method: "POST",
    headers: { "x-auth-token": "hub-secret", "content-type": "application/octet-stream" },
    body: Buffer.from("apply exactly once"),
  };

  const lost = await fetch(target, options);
  assert.equal(lost.status, 502);
  const retried = await fetch(target, options);
  assert.equal(retried.status, 200);
  assert.deepEqual(await retried.json(), { saved: "/tmp/retried.bin", bytes: applied.length });
  assert.equal(calls, 2);
  assert.equal(applied.toString(), "apply exactly once");
});

test("workspace upload concurrency is bounded across Hub proxy routes", async (t) => {
  let startedResolve;
  const started = new Promise((resolvePromise) => { startedResolve = resolvePromise; });
  let releaseResolve;
  const release = new Promise((resolvePromise) => { releaseResolve = resolvePromise; });
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    await requestBytes(req);
    calls += 1;
    if (calls === 1) {
      startedResolve();
      await release;
    }
    sendJson(res, 200, { saved: true });
  });
  const upstreamUrl = await listen(upstream);
  t.after(() => close(upstream));
  const workspace = { id: "alpha", name: "Alpha", url: upstreamUrl, token: null };
  const driver = {
    type: "test", endpoint: "memory://test", capabilities: { list: true },
    async listWorkspaces() { return [workspace]; },
    async getWorkspace(id) { return id === workspace.id ? workspace : null; },
  };
  const config = validateConfig({
    token: "hub-secret", maxConcurrentUploads: 1,
    driver: { type: "mock", endpoint: upstreamUrl },
  }, {});
  const hub = createOysterHub(config, { driver, logger: { error() {} } });
  const hubUrl = await listen(hub);
  t.after(() => close(hub));
  const headers = { "x-auth-token": "hub-secret", "x-oyster-workspace": "alpha", "content-type": "application/octet-stream" };

  const first = fetch(`${hubUrl}/file-upload?name=one&offset=0&last=1`, { method: "POST", headers, body: "a" });
  await started;
  const limited = await fetch(`${hubUrl}/api/v1/workspaces/alpha/file-upload?name=two&offset=0&last=1`, {
    method: "POST", headers: { authorization: "Bearer hub-secret", "content-type": "application/octet-stream" }, body: "b",
  });
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { error: "too many concurrent workspace uploads", workspace: "alpha" });
  releaseResolve();
  assert.equal((await first).status, 200);

  const resumed = await fetch(`${hubUrl}/file-upload?name=three&offset=0&last=1`, { method: "POST", headers, body: "c" });
  assert.equal(resumed.status, 200);
  assert.equal(calls, 2);
});

test("scoped workspace API preserves a large opaque upload byte-for-byte", async (t) => {
  let observed;
  const upstream = createServer(async (req, res) => {
    observed = { path: req.url, headers: req.headers, body: await requestBytes(req) };
    res.writeHead(201, { "content-type": "application/octet-stream", "x-upstream": "yes" });
    res.end(Buffer.from("saved"));
  });
  const upstreamUrl = await listen(upstream);
  t.after(() => close(upstream));
  const workspace = { id: "alpha", name: "Alpha", url: upstreamUrl, token: "workspace-secret" };
  const driver = {
    type: "test", endpoint: "memory://test", capabilities: { list: true },
    async listWorkspaces() { return [workspace]; },
    async getWorkspace(id) { return id === workspace.id ? workspace : null; },
  };
  const hub = createOysterHub(mockHubConfig(upstreamUrl), { driver, logger: { error() {} } });
  const hubUrl = await listen(hub);
  t.after(() => close(hub));
  const body = Buffer.alloc(8 * 1024 * 1024);
  for (let i = 0; i < body.length; i += 1) body[i] = i % 251;

  const response = await fetch(`${hubUrl}/api/v1/workspaces/alpha/file-upload?dir=%2Ftmp&name=large.bin&offset=0&last=1`, {
    method: "POST",
    headers: { authorization: "Bearer hub-secret", "content-type": "application/octet-stream" },
    body,
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("x-oyster-workspace"), "alpha");
  assert.equal(response.headers.get("x-upstream"), "yes");
  assert.equal(await response.text(), "saved");
  assert.equal(observed.path, "/file-upload?dir=%2Ftmp&name=large.bin&offset=0&last=1");
  assert.equal(observed.headers.authorization, "Bearer workspace-secret");
  assert.deepEqual(observed.body, body);
});

test("hub serves the Oyster UI and aggregates workspace-scoped sessions and runners", async (t) => {
  const calls = [];
  const workspaceServer = (id) => createServer(async (req, res) => {
    const url = new URL(req.url, "http://workspace.test");
    calls.push({ id, method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: await requestJson(req) });
    if (url.pathname === "/sessions") return sendJson(res, 200, { sessions: [{ id: "shared", sessionKey: `ps1_${id}`, cwd: "/work", name: `${id} session` }] });
    if (url.pathname === "/runners") return sendJson(res, 200, { runners: [{ id: "runner", sessionId: "shared", sessionKey: `ps1_${id}`, dir: "/work", alive: true }] });
    if (url.pathname === "/open-session") return sendJson(res, 200, { runner: { id: "runner", sessionId: "shared", sessionKey: req.headers["x-test-key"] || `ps1_${id}`, dir: "/work", alive: true } });
    if (url.pathname === "/routines") {
      if (req.method === "POST") return sendJson(res, 200, { routine: { name: "build", path: "/routines/build", sessionId: calls.at(-1).body.sessionId, status: "running" } });
      return sendJson(res, 200, { routines: [{ name: "build", path: "/routines/build", sessionId: "shared", status: "running" }] });
    }
    if (url.pathname === "/tunnels") return sendJson(res, 200, { tunnels: [{ id: "h1", sessionId: "shared", status: "open", url: "https://example.test" }] });
    if (url.pathname === "/pinned-widgets") return sendJson(res, 200, {
      widgets: [{ id: "w1", label: "Cat", kind: "image", mimeType: "image/svg+xml", sessionId: "shared", availability: "ready" }],
      groups: [],
    });
    if (url.pathname === "/pinned-widget-media") {
      const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="5"/></svg>');
      res.writeHead(200, {
        "content-type": "image/svg+xml", "content-length": image.length,
        "content-security-policy": "default-src 'none'; sandbox; style-src 'unsafe-inline'",
      });
      return res.end(image);
    }
    if (url.pathname === "/forbidden-resource") return sendJson(res, 401, { error: "unauthorized" });
    if (url.pathname === "/rpc") return sendJson(res, 202, { runner: url.searchParams.get("runner") });
    if (url.pathname === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      return res.end(`data: ${JSON.stringify({ type: "replay_done", runner: "runner", runners: [{ id: "runner", sessionId: "shared", sessionKey: `ps1_${id}` }] })}\n\n`);
    }
    return sendJson(res, 404, { error: "missing" });
  });
  const alphaServer = workspaceServer("alpha");
  const betaServer = workspaceServer("beta");
  const alphaUrl = await listen(alphaServer);
  const betaUrl = await listen(betaServer);
  t.after(() => close(alphaServer));
  t.after(() => close(betaServer));
  const workspaces = [
    { environmentId: "edge-1", environmentName: "Edge 1", id: "alpha", name: "Alpha", url: alphaUrl, token: null },
    { environmentId: "edge-2", environmentName: "Edge 2", id: "beta", name: "Beta", url: betaUrl, token: null },
  ];
  const driver = {
    type: "test", endpoint: "memory://test", capabilities: { list: true, create: false, remove: false },
    async listWorkspaces() { return workspaces; },
    async getWorkspace(id) { return workspaces.find((workspace) => workspace.id === id) ?? null; },
  };
  const hub = createOysterHub(mockHubConfig(alphaUrl), { driver, logger: { error() {} } });
  const hubUrl = await listen(hub);
  t.after(() => close(hub));
  const headers = { "x-auth-token": "hub-secret" };

  const documentResponse = await fetch(`${hubUrl}/`);
  assert.equal(documentResponse.status, 200);
  const document = await documentResponse.text();
  assert.match(document, /<title>Oyster Hub<\/title>/);
  assert.match(document, /<meta name="application-name" content="Oyster Hub">/);
  assert.match(document, /<meta name="apple-mobile-web-app-title" content="Oyster Hub">/);
  assert.match(document, /<link rel="manifest" href="\/manifest\.webmanifest">/);

  const manifestResponse = await fetch(`${hubUrl}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get("content-type"), "application/manifest+json; charset=utf-8");
  assert.equal(manifestResponse.headers.get("cache-control"), "no-cache");
  const manifest = await manifestResponse.json();
  assert.deepEqual({
    name: manifest.name,
    shortName: manifest.short_name,
    description: manifest.description,
    id: manifest.id,
    startUrl: manifest.start_url,
    scope: manifest.scope,
    display: manifest.display,
  }, {
    name: "Oyster Hub",
    shortName: "Oyster Hub",
    description: "Manage Oyster environments and workspaces.",
    id: "/",
    startUrl: "/",
    scope: "/",
    display: "standalone",
  });
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));

  const serviceWorkerResponse = await fetch(`${hubUrl}/service-worker.js`);
  assert.equal(serviceWorkerResponse.status, 200);
  assert.equal(serviceWorkerResponse.headers.get("content-type"), "text/javascript; charset=utf-8");
  const iconResponse = await fetch(`${hubUrl}/icons/icon-192.png`);
  assert.equal(iconResponse.status, 200);
  assert.equal(iconResponse.headers.get("content-type"), "image/png");

  const runtime = await (await fetch(`${hubUrl}/runtime-config.js`)).text();
  assert.match(runtime, /"hub":true/);
  const deniedResource = await fetch(`${hubUrl}/routines`);
  assert.equal(deniedResource.status, 401);
  assert.deepEqual(await deniedResource.json(), { error: "unauthorized for GET /routines" });

  const sessionsResponse = await fetch(`${hubUrl}/sessions?all=1`, { headers });
  assert.equal(sessionsResponse.status, 200);
  const sessions = (await sessionsResponse.json()).sessions;
  assert.deepEqual(sessions.map((session) => [session.environmentId, session.environmentName, session.workspaceId, session.workspaceName]), [
    ["edge-1", "Edge 1", "alpha", "Alpha"],
    ["edge-2", "Edge 2", "beta", "Beta"],
  ]);
  assert.notEqual(sessions[0].id, sessions[1].id);
  assert.deepEqual(parseScopedValue(sessions[1].sessionKey), { workspaceId: "beta", kind: "session", value: "ps1_beta" });

  const runners = (await (await fetch(`${hubUrl}/runners`, { headers })).json()).runners;
  assert.deepEqual(runners.map((runner) => [runner.environmentId, runner.workspaceId]), [["edge-1", "alpha"], ["edge-2", "beta"]]);

  const betaHeaders = { ...headers, "x-oyster-workspace": "beta" };
  const betaRoutines = (await (await fetch(`${hubUrl}/routines`, { headers: betaHeaders })).json()).routines;
  assert.deepEqual(betaRoutines.map((routine) => [routine.workspaceId, routine.sessionId]), [["beta", sessions[1].id]]);
  const betaHublots = (await (await fetch(`${hubUrl}/tunnels`, { headers: betaHeaders })).json()).tunnels;
  assert.deepEqual(betaHublots.map((hublot) => [hublot.workspaceId, hublot.sessionId]), [["beta", sessions[1].id]]);
  assert.deepEqual(parseScopedValue(betaHublots[0].id), { workspaceId: "beta", kind: "hublot", value: "h1" });

  const betaWidgets = (await (await fetch(`${hubUrl}/pinned-widgets`, { headers: betaHeaders })).json()).widgets;
  assert.deepEqual(parseScopedValue(betaWidgets[0].id), { workspaceId: "beta", kind: "pinned-widget", value: "w1" });
  const betaThumbnail = await fetch(`${hubUrl}/pinned-widget-media?id=${encodeURIComponent(betaWidgets[0].id)}`, { headers });
  assert.equal(betaThumbnail.status, 200);
  assert.equal(betaThumbnail.headers.get("content-type"), "image/svg+xml");
  assert.match(betaThumbnail.headers.get("content-security-policy"), /style-src 'unsafe-inline'/);
  assert.match(await betaThumbnail.text(), /^<svg/);
  assert.equal(calls.at(-1).id, "beta");
  assert.equal(calls.at(-1).query.id, "w1");

  const allHublotResponse = await fetch(`${hubUrl}/tunnels?all=1`, { headers });
  assert.equal(allHublotResponse.status, 200);
  const allHublots = (await allHublotResponse.json()).tunnels;
  assert.deepEqual(allHublots.map((hublot) => [hublot.workspaceId, hublot.sessionId]), [
    ["alpha", sessions[0].id], ["beta", sessions[1].id],
  ]);
  assert.equal(new Set(allHublots.map((hublot) => hublot.id)).size, 2, "workspace-local hublot ids remain distinct through the Hub");
  const startedRoutine = await fetch(`${hubUrl}/routines`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ name: "build", action: "start", sessionId: sessions[1].id }),
  });
  assert.equal(startedRoutine.status, 200);
  assert.equal((await startedRoutine.json()).routine.sessionId, sessions[1].id);
  assert.equal(calls.at(-1).id, "beta");
  assert.equal(calls.at(-1).body.sessionId, "shared");

  const forbidden = await fetch(`${hubUrl}/forbidden-resource`, { headers: betaHeaders });
  assert.equal(forbidden.status, 401);
  assert.deepEqual(await forbidden.json(), { error: "GET /forbidden-resource on workspace \"Beta\" (beta): unauthorized" });

  const betaRunner = runners[1].id;
  const rpc = await fetch(`${hubUrl}/rpc?runner=${encodeURIComponent(betaRunner)}`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ type: "get_state" }),
  });
  assert.equal(rpc.status, 202);
  assert.equal((await rpc.json()).runner, "runner");
  assert.equal(calls.at(-1).id, "beta");
  assert.equal(calls.at(-1).query.runner, "runner");

  const unscoped = await fetch(`${hubUrl}/rpc`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ type: "get_state" }),
  });
  assert.equal(unscoped.status, 400);
  assert.deepEqual(await unscoped.json(), {
    error: "workspace is required",
    hint: "send a scoped identity, X-Oyster-Workspace header, or workspace query parameter",
  });

  const explicit = await fetch(`${hubUrl}/rpc?runner=runner`, {
    method: "POST",
    headers: { ...headers, "x-oyster-workspace": "beta", "content-type": "application/json" },
    body: JSON.stringify({ type: "get_state" }),
  });
  assert.equal(explicit.status, 202);
  assert.equal(calls.at(-1).id, "beta");

  const events = await fetch(`${hubUrl}/events?token=hub-secret&runner=${encodeURIComponent(betaRunner)}`);
  assert.equal(events.status, 200);
  const event = JSON.parse((await events.text()).match(/data: (.*)/)[1]);
  assert.equal(parseScopedValue(event.runner).workspaceId, "beta");
  assert.deepEqual(event.runners.map((runner) => runner.workspaceId), ["beta"], "selected workspace replay is not delayed for fleet enrichment");
  assert.equal(calls.at(-1).query.token, undefined);

  const opened = await fetch(`${hubUrl}/open-session`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ sessionKey: sessions[1].sessionKey }),
  });
  assert.equal(opened.status, 200);
  assert.equal((await opened.json()).runner.workspaceId, "beta");
  assert.equal(calls.at(-1).id, "beta");
  assert.equal(calls.at(-1).body.sessionKey, "ps1_beta");
});

test("Hub forwards selected SSE before other workspace runner snapshots finish", async (t) => {
  let releaseSnapshot;
  let markSnapshotStarted;
  const snapshotStarted = new Promise((resolve) => { markSnapshotStarted = resolve; });
  const snapshotGate = new Promise((resolve) => { releaseSnapshot = resolve; });
  const alpha = createServer(async (req, res) => {
    if (new URL(req.url, "http://alpha.test").pathname !== "/runners") return sendJson(res, 404, { error: "missing" });
    markSnapshotStarted();
    await snapshotGate;
    sendJson(res, 200, { runners: [{ id: "alpha-runner", alive: true }] });
  });
  const beta = createServer((req, res) => {
    if (new URL(req.url, "http://beta.test").pathname !== "/events") return sendJson(res, 404, { error: "missing" });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "replay_done", runner: "beta-runner", runners: [{ id: "beta-runner", alive: true }] })}\n\n`);
  });
  const alphaUrl = await listen(alpha);
  const betaUrl = await listen(beta);
  t.after(() => close(alpha));
  t.after(() => close(beta));
  const workspaces = [
    { environmentId: "one", id: "alpha", name: "Alpha", url: alphaUrl },
    { environmentId: "two", id: "beta", name: "Beta", url: betaUrl },
  ];
  const driver = {
    type: "test", endpoint: "memory://test", capabilities: { list: true, create: false, remove: false },
    async listWorkspaces() { return workspaces; },
    async getWorkspace(id) { return workspaces.find((workspace) => workspace.id === id) ?? null; },
  };
  const hub = createOysterHub(mockHubConfig(betaUrl), { driver, logger: { error() {}, warn() {} } });
  const hubUrl = await listen(hub);
  t.after(() => close(hub));
  const abort = new AbortController();
  t.after(() => { releaseSnapshot(); abort.abort(); });

  const response = await Promise.race([
    fetch(`${hubUrl}/events?token=hub-secret&workspace=beta`, { signal: abort.signal }),
    new Promise((_, reject) => setTimeout(() => { releaseSnapshot(); abort.abort(); reject(new Error("selected SSE was blocked by another workspace")); }, 500)),
  ]);
  const reader = response.body.getReader();
  const first = await reader.read();
  const firstText = Buffer.from(first.value).toString("utf8");
  assert.match(firstText, /replay_done/);
  assert.doesNotMatch(firstText, /alpha-runner/);
  await Promise.race([
    snapshotStarted,
    new Promise((_, reject) => setTimeout(() => { releaseSnapshot(); abort.abort(); reject(new Error("fleet runner snapshot did not start")); }, 500)),
  ]);

  releaseSnapshot();
  let enriched = "";
  while (!enriched.includes("runners_update")) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => { abort.abort(); reject(new Error("fleet runner enrichment was not delivered")); }, 500)),
    ]);
    assert.equal(chunk.done, false);
    enriched += Buffer.from(chunk.value).toString("utf8");
  }
  const update = JSON.parse(enriched.match(/data: (.*)/)[1]);
  assert.deepEqual(update.runners.map((runner) => runner.workspaceId), ["alpha", "beta"]);
  abort.abort();
});

test("workspace SSE streams remain open after the upstream connection timeout", async (t) => {
  const { hubUrl } = await fleet(t, 100);
  const response = await fetch(`${hubUrl}/api/v1/workspaces/local/events`, {
    headers: { authorization: "Bearer hub-secret" },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "data: late-event\n\n");
});
