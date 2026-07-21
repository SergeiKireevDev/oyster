import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { createRequestContext } from "../server/http/createRequestContext.mjs";
import { createOpenRoutes } from "../server/http/routes/openRoutes.mjs";

function response() {
  return {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
}

function setup() {
  const state = {
    config: {
      TOKEN: "open-token", PI_DIR: tmpdir(), DIRNAME: tmpdir(),
      PI_BIN: "/configured/pi", PERSISTENT_STORE: "sqlite", SQLITE_PATH: "/agent/sessions.sqlite",
    },
    piProcesses: { bin: "/running/pi", persistentStore: "sqlite" },
    appStore: { path: "/agent/oyster.sqlite", migrationStatus: { currentVersion: 1, appliedVersions: [1] } },
    sseClients: new Set([{}]),
    reloadCount: 7,
  };
  const requestContext = createRequestContext(state, { logger: { log() {} } });
  const routes = createOpenRoutes({
    state,
    listRunnerInfo: () => [{ id: "runner-1" }],
    requestContext,
  });
  return { state, routes };
}

test("health route reports stable state including the reload count without auth", () => {
  const { routes } = setup();
  const res = response();
  routes["GET /health"]({ headers: {} }, res);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), {
    ok: true,
    runners: [{ id: "runner-1" }],
    clients: 1,
    reloadCount: 7,
    appDatabase: { path: "/agent/oyster.sqlite", migrations: { currentVersion: 1, appliedVersions: [1] } },
    pi: { bin: "/running/pi", persistentStore: "sqlite", sqlitePath: "/agent/sessions.sqlite" },
  });
});

test("health diagnostics follow the running launcher and cannot falsely claim SQLite", () => {
  const { state, routes } = setup();
  state.piProcesses = { bin: "/global/pi", persistentStore: "jsonl" };
  const res = response();
  routes["GET /health"]({ headers: {} }, res);
  const health = JSON.parse(res.body);
  assert.deepEqual(health.pi, { bin: "/global/pi", persistentStore: "jsonl", sqlitePath: null });
  assert.equal(JSON.stringify(health).includes("open-token"), false);
});

test("authcheck remains an open credential report without exposing token values", () => {
  const { routes } = setup();
  const req = {
    method: "GET",
    headers: { authorization: "Bearer open-token", "x-api-key": "wrong" },
    socket: { remoteAddress: "192.0.2.2" },
  };
  const res = response();
  routes["GET /authcheck"](req, res, new URL("http://localhost/authcheck"));
  assert.equal(res.status, 200);
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
