import test from "node:test";
import assert from "node:assert/strict";
import { createSessionRoutes } from "../server/http/routes/sessionRoutes.mjs";
import { createSessionReferenceCodec } from "../server/session-references.mjs";

function response() { return {}; }

function setup({ sessionOperations = null } = {}) {
  const storagePath = "/agent/sessions.sqlite";
  const codec = createSessionReferenceCodec({ agentDir: "/agent", sqlitePath: storagePath });
  const sessions = [
    { id: "root", cwd: "/work", storagePath, parentSessionId: null, preview: "root", messageCount: 2 },
    { id: "fork", cwd: "/work", storagePath, parentSessionId: "root", preview: "fork", messageCount: 2 },
  ];
  const catalog = {
    backend: "sqlite",
    storagePath,
    root: "/agent",
    list: ({ cwd }) => sessions.filter((session) => !cwd || session.cwd === cwd),
    findById: (id) => sessions.find((session) => session.id === id) ?? null,
    entries: (id) => ({ sessionId: id, leafId: "a", entries: [{ id: "a", role: "assistant" }] }),
    messages: (id) => ({ sessionId: id, messages: [{ role: "assistant", content: id }] }),
    folders: () => [{ dir: "/work", label: "/work", count: 2 }],
    locationForCwd: (cwd) => cwd,
    search: (options) => ({ results: [{ sessionId: options.path ?? "root", sessionCwd: "/work", snippet: {} }], filesSearched: 1, truncated: false }),
    usageAnalytics: (options) => ({ bucket: options.bucket, total: { requests: 3, cost: 1.25 }, models: [], series: [] }),
  };
  const runnerRef = { backend: "sqlite", id: "root", storagePath };
  const lifecycle = [];
  const owners = new Map();
  let nextOwnerId = 1;
  const sessionRepository = {
    upsert({ backend, sessionId, storagePath: path = null, createdAt }) {
      const key = `${backend}:${sessionId}:${path ?? ""}`;
      if (!owners.has(key)) owners.set(key, { id: nextOwnerId++, backend, session_id: sessionId, storage_path: path, status: "active", archived: 0, created_at: createdAt });
      return { ...owners.get(key) };
    },
    find({ backend, sessionId, storagePath: path = null }) { return owners.get(`${backend}:${sessionId}:${path ?? ""}`) ?? null; },
    setArchived(id, archived) {
      const owner = [...owners.values()].find((candidate) => candidate.id === id);
      if (!owner) return 0;
      owner.archived = archived ? 1 : 0;
      return 1;
    },
  };
  const state = {
    currentDir: "/work",
    runners: new Map([["r1", { id: "r1", sessionRef: runnerRef, proc: {}, busy: true }]]),
    tunnels: new Map(),
    sessionReferences: codec,
    appStore: { repositories: { sessions: sessionRepository } },
  };
  const routes = createSessionRoutes({
    state,
    requestContext: {
      json(res, status, body) { res.status = status; res.body = body; },
      async readJsonBody(req) { return req.body; },
    },
    sessions: { catalog, readSessionHeaderInfo() {}, sessionReferenceFor() {}, sessionTargetFromSearch() {} },
    runners: { stopRunner: (runner) => lifecycle.push(["stop", runner.id]), runnersChanged: () => lifecycle.push(["changed"]) },
    resources: { closeTunnel() {}, releaseSessionRoutines: (_state, id) => { lifecycle.push(["release", id]); return ["routine"]; } },
    sessionOperations,
    resolvePath: (path) => path,
    now: () => Date.parse("2026-01-08T00:00:00Z"),
  });
  return { routes, codec, sessions, state, lifecycle, owners };
}

test("SQLite usage analytics validates and forwards range aggregation", () => {
  const { routes } = setup();
  const res = response();
  routes["GET /analytics/usage"]({}, res, new URL("http://localhost/analytics/usage?range=7d&bucket=hour"));
  assert.equal(res.status, 200);
  assert.equal(res.body.bucket, "hour");
  assert.equal(res.body.since, "2026-01-01T00:00:00.000Z");
  assert.equal(res.body.total.cost, 1.25);
  const invalid = response();
  routes["GET /analytics/usage"]({}, invalid, new URL("http://localhost/analytics/usage?bucket=minute"));
  assert.equal(invalid.status, 400);
});

test("SQLite routes can list every known session without a cwd filter", () => {
  const { routes, sessions } = setup();
  sessions.push({ id: "other", cwd: "/other", storagePath: "/agent/sessions.sqlite", parentSessionId: null, preview: "other", messageCount: 1 });

  const scoped = response();
  routes["GET /sessions"]({}, scoped, new URL("http://localhost/sessions"));
  assert.equal(scoped.body.sessions.length, 2);

  const all = response();
  routes["GET /sessions"]({}, all, new URL("http://localhost/sessions?all=1"));
  assert.equal(all.body.sessions.length, 3);
});

test("SQLite routes list distinct shared-database identities and parent keys", () => {
  const { routes, codec } = setup();
  const res = response();
  routes["GET /sessions"]({}, res, new URL("http://localhost/sessions?dir=/work"));
  assert.equal(res.status, 200);
  assert.equal(res.body.sessions.length, 2);
  assert.notEqual(res.body.sessions[0].sessionKey, res.body.sessions[1].sessionKey);
  assert.equal(res.body.sessions[0].path, null);
  assert.deepEqual(res.body.sessions[0].sessionRef, { backend: "sqlite", id: "root", storagePath: "/agent/sessions.sqlite" });
  assert.equal(res.body.sessions[0].alive, true);
  assert.equal(res.body.sessions[1].parentSessionKey, codec.serialize({ backend: "sqlite", id: "root", storagePath: "/agent/sessions.sqlite" }));
});

test("SQLite session archive route persists and returns the archived flag", async () => {
  const { routes, codec } = setup();
  const listed = response();
  routes["GET /sessions"]({}, listed, new URL("http://localhost/sessions?dir=/work"));
  const key = codec.serialize({ backend: "sqlite", id: "fork", storagePath: "/agent/sessions.sqlite" });
  assert.equal(listed.body.sessions.find((session) => session.id === "fork").archived, false);

  const archived = response();
  await routes["POST /session/archive"]({ body: { sessionKey: key, archived: true } }, archived);
  assert.deepEqual(archived.body, { sessionKey: key, archived: true });

  const refreshed = response();
  routes["GET /sessions"]({}, refreshed, new URL("http://localhost/sessions?dir=/work"));
  assert.equal(refreshed.body.sessions.find((session) => session.id === "fork").archived, true);
});

test("SQLite routes resolve lookup, entries, messages, folders, and search by key", () => {
  const { routes, codec } = setup();
  const key = codec.serialize({ backend: "sqlite", id: "fork", storagePath: "/agent/sessions.sqlite" });

  const lookup = response();
  routes["GET /session-by-id"]({}, lookup, new URL("http://localhost/session-by-id?id=fork"));
  assert.equal(lookup.body.session.sessionKey, key);

  const entries = response();
  routes["GET /session-entries"]({}, entries, new URL(`http://localhost/session-entries?key=${key}`));
  assert.equal(entries.body.sessionId, "fork");

  const messages = response();
  routes["GET /session-messages"]({}, messages, new URL(`http://localhost/session-messages?key=${key}`));
  assert.equal(messages.body.messages[0].content, "fork");

  const folders = response();
  routes["GET /session-folders"]({}, folders, new URL("http://localhost/session-folders?dir=/work"));
  assert.deepEqual(folders.body.current, "/work");

  const search = response();
  routes["GET /search"]({}, search, new URL(`http://localhost/search?q=phrase&scope=session&key=${key}`));
  assert.equal(search.status, 200);
  assert.equal(search.body.results[0].sessionKey, key);
});

test("SQLite deletion stops its runner, delegates mutation, then releases resources", async () => {
  const calls = [];
  const { routes, codec, state, lifecycle } = setup({ sessionOperations: {
    capabilities: { delete: { sqlite: true } },
    async deleteSession(reference) { calls.push(reference.id); return { deleted: codec.serialize(reference) }; },
  } });
  const key = codec.serialize({ backend: "sqlite", id: "root", storagePath: "/agent/sessions.sqlite" });
  const responseValue = response();
  await routes["DELETE /session"]({}, responseValue, new URL(`http://localhost/session?key=${key}`));
  assert.equal(responseValue.status, 200);
  assert.deepEqual(calls, ["root"]);
  assert.deepEqual(lifecycle, [["stop", "r1"], ["changed"], ["release", "root"]]);
  assert.equal(state.runners.size, 0);
});

test("SQLite deletion failure preserves session resources and runner identity", async () => {
  const { routes, codec, state, lifecycle } = setup({ sessionOperations: {
    capabilities: { delete: { sqlite: true } },
    async deleteSession() { throw new Error("database busy"); },
  } });
  const key = codec.serialize({ backend: "sqlite", id: "root", storagePath: "/agent/sessions.sqlite" });
  const responseValue = response();
  await routes["DELETE /session"]({}, responseValue, new URL(`http://localhost/session?key=${key}`));
  assert.equal(responseValue.status, 500);
  assert.deepEqual(lifecycle, [["stop", "r1"]]);
  assert.equal(state.runners.size, 1);
});

test("SQLite routes reject file identities and unsupported mutation before side effects", async () => {
  const { routes, codec } = setup();
  const entries = response();
  routes["GET /session-entries"]({}, entries, new URL("http://localhost/session-entries?path=/agent/sessions.sqlite"));
  assert.equal(entries.status, 404);
  const bareDatabase = response();
  await routes["DELETE /session"]({}, bareDatabase, new URL("http://localhost/session?path=/agent/sessions.sqlite"));
  assert.equal(bareDatabase.status, 400);
  const key = codec.serialize({ backend: "sqlite", id: "root", storagePath: "/agent/sessions.sqlite" });
  const deletion = response();
  await routes["DELETE /session"]({}, deletion, new URL(`http://localhost/session?key=${key}`));
  assert.equal(deletion.status, 409);
});
