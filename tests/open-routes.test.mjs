import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { createRequestContext } from "../server/http/createRequestContext.mjs";
import { createOpenRoutes } from "../server/http/routes/openRoutes.mjs";

function response() {
  return {
    presetHeaders: {},
    setHeader(name, value) { this.presetHeaders[name] = value; },
    writeHead(status, headers) { this.status = status; this.headers = { ...this.presetHeaders, ...headers }; },
    end(body) { this.body = body; },
  };
}

function setup(configOverrides = {}) {
  const state = {
    config: {
      TOKEN: "open-token", PI_DIR: tmpdir(), DIRNAME: tmpdir(),
      PI_BIN: "/configured/pi", PERSISTENT_STORE: "sqlite", SQLITE_PATH: "/agent/sessions.sqlite",
      ...configOverrides,
    },
    piProcesses: { bin: "/running/pi", persistentStore: "sqlite" },
    appStore: { path: "/agent/oyster.sqlite", migrationStatus: { currentVersion: 1, appliedVersions: [1] } },
    sseClients: new Set([{}]),
    reloadCount: 7,
  };
  const requestContext = createRequestContext(state, { logger: { log() {} } });
  const routes = createOpenRoutes({
    state,
    listRunnerInfo: () => [{ id: "runner-1", dir: "/secret/worktree", sessionKey: "secret-session", alive: true, busy: false }],
    requestContext,
  });
  return { state, routes };
}

test("runtime config exposes spoke authentication mode without secrets", async () => {
  for (const unauthenticated of [false, true]) {
    const { routes } = setup({ UNAUTHENTICATED: unauthenticated });
    const res = response();
    await routes["GET /runtime-config.js"]({ headers: {} }, res);
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "text/javascript; charset=utf-8");
    assert.equal(res.body, `globalThis.__OYSTER_RUNTIME_CONFIG__ = Object.freeze({"unauthenticated":${unauthenticated},"harnesses":[{"id":"pi","label":"pi"}]});\n`);
    assert.equal(res.body.includes("open-token"), false);
  }
});

test("health route reports safe live diagnostics without exposing runner or filesystem identities", async () => {
  const { routes } = setup();
  const res = response();
  await routes["GET /health"]({ headers: {} }, res);
  assert.equal(res.status, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(JSON.parse(res.body), {
    ok: true,
    runners: [{ alive: true, busy: false }],
    clients: 1,
    reloadCount: 7,
    appDatabase: { migrations: { currentVersion: 1, appliedVersions: [1] } },
    pi: { persistentStore: "sqlite" },
  });
  assert.doesNotMatch(res.body, /secret|runner-1|\/agent|\/running/);
});

test("health diagnostics follow the running launcher and cannot falsely claim SQLite", async () => {
  const { state, routes } = setup();
  state.piProcesses = { bin: "/global/pi", persistentStore: "jsonl" };
  const res = response();
  await routes["GET /health"]({ headers: {} }, res);
  const health = JSON.parse(res.body);
  assert.deepEqual(health.pi, { persistentStore: "jsonl" });
  assert.equal(JSON.stringify(health).includes("open-token"), false);
});

test("authcheck reports that credentials are unnecessary in explicit unauthenticated mode", async () => {
  const { routes } = setup({ UNAUTHENTICATED: true });
  const res = response();
  await routes["GET /authcheck"]({ method: "GET", headers: {}, socket: { remoteAddress: "192.0.2.3" } }, res, new URL("http://localhost/authcheck"));
  assert.deepEqual(JSON.parse(res.body), { authorized: true, unauthenticated: true });
});

test("authcheck remains an uncached credential report without exposing token values", async () => {
  const { routes } = setup();
  const req = {
    method: "GET",
    headers: { authorization: "Bearer open-token", "x-api-key": "wrong" },
    socket: { remoteAddress: "192.0.2.2" },
  };
  const res = response();
  await routes["GET /authcheck"](req, res, new URL("http://localhost/authcheck"));
  assert.equal(res.status, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(JSON.parse(res.body), {
    authorized: true,
    credentials: {
      query: "absent",
      bearer: "valid",
      xAuthToken: "absent",
      xApiKey: "present-invalid(len=5)",
      cookie: "absent",
    },
  });
});

test("route construction validates dependencies and the authentication limit", () => {
  assert.throws(() => createOpenRoutes(), /state\.config is required/);
  assert.throws(() => createOpenRoutes({ state: { config: {} }, listRunnerInfo() {} }), /requestContext/);
  assert.throws(() => createOpenRoutes({
    state: { config: {} }, listRunnerInfo() {},
    requestContext: Object.fromEntries(
      ["json", "text", "tokenMatches", "authCandidates", "clientIp", "recentAuthFailures", "recordAuthFailure"]
        .map((name) => [name, () => {}]),
    ),
    authFailMax: -1,
  }), /authFailMax/);
});

test("health diagnostics tolerate unavailable counters and malformed internal values", async () => {
  const { state, routes } = setup();
  state.sseClients = null;
  state.reloadCount = -1;
  state.appStore.migrationStatus = { currentVersion: "secret", appliedVersions: [1, "bad", -2, 3] };
  state.piProcesses.persistentStore = "/secret/backend";
  const res = response();
  await routes["GET /health"]({}, res);
  assert.deepEqual(JSON.parse(res.body), {
    ok: true,
    runners: [{ alive: true, busy: false }],
    clients: null,
    reloadCount: null,
    appDatabase: { migrations: { currentVersion: null, appliedVersions: [1, 3] } },
    pi: { persistentStore: "unknown" },
  });
  assert.doesNotMatch(res.body, /secret/);
});

test("a successful authcheck clears prior failures and compares each candidate only once", async () => {
  const { state } = setup();
  state.authFails = new Map([["192.0.2.8", [1, 2]]]);
  let comparisons = 0;
  const requestContext = {
    json: (res, status, body) => { res.status = status; res.body = body; },
    text() {},
    tokenMatches: (value) => { comparisons++; return value === "valid"; },
    authCandidates: () => ({ bearer: "valid", cookie: "wrong", query: null }),
    clientIp: () => "192.0.2.8",
    recentAuthFailures: () => state.authFails.get("192.0.2.8") ?? [],
    recordAuthFailure: () => assert.fail("valid authentication must not be recorded as a failure"),
  };
  const routes = createOpenRoutes({ state, listRunnerInfo: () => [], requestContext });
  const res = response();
  await routes["GET /authcheck"]({}, res, new URL("http://localhost/authcheck"));
  assert.equal(res.body.authorized, true);
  assert.equal(comparisons, 2);
  assert.equal(state.authFails.has("192.0.2.8"), false);
});
