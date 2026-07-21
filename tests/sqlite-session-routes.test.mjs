import test from "node:test";
import assert from "node:assert/strict";
import { createSessionRoutes } from "../http/routes/sessionRoutes.mjs";
import { createSessionReferenceCodec } from "../session-references.mjs";

function response() { return {}; }

function setup() {
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
  };
  const runnerRef = { backend: "sqlite", id: "root", storagePath };
  const state = {
    currentDir: "/work",
    runners: new Map([["r1", { id: "r1", sessionRef: runnerRef, proc: {}, busy: true }]]),
    tunnels: new Map(),
    sessionReferences: codec,
  };
  const routes = createSessionRoutes({
    state,
    requestContext: { json(res, status, body) { res.status = status; res.body = body; } },
    sessions: { catalog, readSessionHeaderInfo() {}, sessionReferenceFor() {}, sessionTargetFromSearch() {} },
    runners: { stopRunner() {}, runnersChanged() {} },
    resources: { closeTunnel() {}, releaseSessionRoutines: () => [] },
    resolvePath: (path) => path,
  });
  return { routes, codec, sessions };
}

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

test("SQLite routes reject file identities and mutation before side effects", () => {
  const { routes } = setup();
  const entries = response();
  routes["GET /session-entries"]({}, entries, new URL("http://localhost/session-entries?path=/agent/sessions.sqlite"));
  assert.equal(entries.status, 404);
  const deletion = response();
  routes["DELETE /session"]({}, deletion, new URL("http://localhost/session?path=/agent/sessions.sqlite"));
  assert.equal(deletion.status, 409);
});
