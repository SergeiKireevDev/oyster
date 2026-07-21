import test from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "../app.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function stableState() {
  const state = {
    config: {
      TOKEN: "dispatch-token",
      PI_DIR: projectRoot,
      DIRNAME: projectRoot,
      PI_BIN: "pi",
      PI_EXTRA_ARGS: [],
      TUNNEL_BIN: "cloudflared",
    },
    currentDir: projectRoot,
    tunnels: new Map(),
    sseClients: new Set(),
    reloadCount: 1,
    legacyCheckpointsImported: true,
    legacyRoutinesImported: true,
    hublotSupervisor: { start() {}, stop() {} },
    appStore: {
      path: "/tmp/pi-lot-ui.sqlite", migrationStatus: { currentVersion: 7, appliedVersions: [1, 2, 3, 4, 5, 6, 7] },
      repositories: {
        sessions: { upsert: (owner) => owner }, operations: { listIncomplete: () => [] },
        checkpoints: { load: () => ({}), save() {} },
      },
      hydrate: () => ({ incompleteOperations: [] }),
    },
    broadcast() {},
    serverEvent() {},
  };
  return state;
}

function request(path, headers = {}) {
  return {
    method: "GET",
    url: path,
    headers: { host: "localhost", ...headers },
    socket: { remoteAddress: "192.0.2.10" },
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

  const authorized = response();
  await application.handleRequest(request("/runners", { authorization: "Bearer dispatch-token" }), authorized);
  assert.equal(authorized.status, 200);
  assert.deepEqual(JSON.parse(authorized.body), { runners: [] });
});
