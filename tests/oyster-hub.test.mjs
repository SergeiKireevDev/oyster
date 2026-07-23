import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOysterHub } from "../oyster-hub/app.mjs";
import { loadConfig, validateConfig } from "../oyster-hub/config.mjs";
import { deriveWorkspaceToken } from "../oyster-hub/drivers/llmbox.mjs";
import { createMockWorkspaceDriver } from "../oyster-hub/drivers/mock.mjs";
import { parseScopedValue } from "../oyster-hub/ui-gateway.mjs";

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
  assert.throws(() => validateConfig({ token: "x", driver: {
    type: "llmbox", endpoint: "file:///tmp/box", token: "key", tokenSecret: "secret",
  } }, {}), /must use http or https/);
  assert.throws(() => validateConfig({ token: "x", driver: {
    type: "llmbox", endpoint: "http://localhost", token: "key", tokenSecret: "secret", workspacePort: 70000,
  } }, {}), /workspacePort/);
  assert.throws(() => validateConfig({ token: "x", driver: {
    type: "llmbox", transport: "pipe", tokenSecret: "secret",
  } }, {}), /transport must be http or native/);
  const native = validateConfig({ token: "x", driver: {
    type: "llmbox", transport: "native", tokenSecret: "secret",
    binding: { addonPath: "build/llmbox.node", configPath: "llmbox.yaml" },
  } }, {});
  assert.equal(native.driver.endpoint, "native://embedded-llmbox");
  assert.equal(native.driver.transport, "native");
  assert.match(native.driver.binding.addonPath, /build\/llmbox\.node$/);
  assert.match(native.driver.binding.configPath, /llmbox\.yaml$/);
  assert.equal("token" in native.driver, false);

  const mock = validateConfig({ token: "x", port: 8082, driver: { type: "mock" } }, {});
  assert.equal(mock.port, 8082);
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
    { id: "local", name: "Local", status: "online", local: true },
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
    capabilities: { list: true, create: true, remove: false },
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
    { id: "edge-1", name: "edge-1", status: "online", default: true },
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
  assert.match(await documentResponse.text(), /<title>Oyster Hub<\/title>/);
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
  assert.deepEqual(event.runners.map((runner) => runner.workspaceId), ["alpha", "beta"]);
  assert.equal(calls.at(-1).query.token, undefined);

  const opened = await fetch(`${hubUrl}/open-session`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ sessionKey: sessions[1].sessionKey }),
  });
  assert.equal(opened.status, 200);
  assert.equal((await opened.json()).runner.workspaceId, "beta");
  assert.equal(calls.at(-1).id, "beta");
  assert.equal(calls.at(-1).body.sessionKey, "ps1_beta");
});

test("workspace SSE streams remain open after the upstream connection timeout", async (t) => {
  const { hubUrl } = await fleet(t, 100);
  const response = await fetch(`${hubUrl}/api/v1/workspaces/local/events`, {
    headers: { authorization: "Bearer hub-secret" },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "data: late-event\n\n");
});
