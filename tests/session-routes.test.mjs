import test from "node:test";
import assert from "node:assert/strict";
import { createSessionRoutes } from "../http/routes/sessionRoutes.mjs";

function setup() {
  const stopped = [];
  const closed = [];
  const unlinked = [];
  const deletedCheckpoints = [];
  const deletedRoutineOwners = [];
  const searches = [];
  const runner = { id: "r1", sessionFile: "/sessions/folder/a.jsonl", proc: {}, busy: true };
  const state = {
    currentDir: "/work",
    defaultRunnerId: "r1",
    runners: new Map([[runner.id, runner]]),
    tunnels: new Map([["t1", { id: "t1", port: 4000, sessionId: "session-a" }]]),
    sessionReferences: {
      serialize: (reference) => `key-${reference.id}`,
      equals: (left, right) => left.backend === right.backend && left.id === right.id && left.storagePath === right.storagePath,
    },
  };
  const dependencies = {
    state,
    requestContext: { json(res, status, body) { res.status = status; res.body = body; } },
    sessions: {
      catalog: {
        backend: "jsonl",
        root: "/sessions",
        locationForCwd: (dir) => `/sessions/${dir.replaceAll("/", "-")}`,
        list: ({ location }) => [{ id: "session-a", path: "/sessions/folder/a.jsonl", dir: location }],
        folders: () => ["/sessions/folder"],
        search: (options) => { searches.push(options); return { results: [{ sessionId: "session-a", sessionPath: "/sessions/folder/a.jsonl", snippet: "matching text" }] }; },
        entries: (path) => [{ id: "entry", path }],
        messages: (path) => [{ role: "user", path }],
        findById: (id) => id === "session-a" ? { id: "session-a", name: "A", path: "/sessions/folder/a.jsonl" } : null,
      },
      readSessionHeaderInfo: () => ({ id: "session-a" }),
      sessionReferenceFor: ({ id, path }) => ({ backend: "jsonl", id, storagePath: path }),
      sessionTargetFromSearch: (url) => ["folder/a.jsonl", "key-session-a"].includes(url.searchParams.get("path") ?? url.searchParams.get("key")) ? "/sessions/folder/a.jsonl" : null,
    },
    runners: {
      stopRunner: (selected) => stopped.push(selected.id),
      runnersChanged: () => { state.runnersBroadcast = true; },
    },
    resources: {
      closeTunnel: (_state, id) => closed.push(id),
      releaseSessionRoutines: (_state, id) => { deletedRoutineOwners.push(id); return ["routine-a"]; },
      deleteSessionCheckpoints: (id) => { deletedCheckpoints.push(id); return 1; },
    },
    resolvePath: (path) => path,
    unlinkFile: (path) => unlinked.push(path),
    logger: { log() {} },
  };
  return { state, stopped, closed, unlinked, deletedCheckpoints, deletedRoutineOwners, searches, routes: createSessionRoutes(dependencies) };
}

function response() { return {}; }

test("session listing preserves root scope and live runner annotations", () => {
  const { routes } = setup();
  const escaped = response();
  routes["GET /sessions"]({}, escaped, new URL("http://localhost/sessions?path=/sessions-escape"));
  assert.equal(escaped.status, 400);

  const listed = response();
  routes["GET /sessions"]({}, listed, new URL("http://localhost/sessions?path=/sessions/folder"));
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.sessions[0], {
    id: "session-a",
    path: "/sessions/folder/a.jsonl",
    dir: "/sessions/folder",
    runnerId: "r1",
    alive: true,
    busy: true,
    sessionRef: { backend: "jsonl", id: "session-a", storagePath: "/sessions/folder/a.jsonl" },
    sessionKey: "key-session-a",
    parentSession: null,
    parentSessionKey: null,
  });
});

test("session lookup, entries, messages, and folders preserve response shapes", () => {
  const { routes } = setup();
  const lookup = response();
  routes["GET /session-by-id"]({}, lookup, new URL("http://localhost/session-by-id?id=session-a"));
  assert.deepEqual(lookup.body, { session: {
    path: "/sessions/folder/a.jsonl", id: "session-a", name: "A",
    sessionRef: { backend: "jsonl", id: "session-a", storagePath: "/sessions/folder/a.jsonl" },
    sessionKey: "key-session-a",
    parentSession: null,
    parentSessionKey: null,
  } });

  const missingId = response();
  routes["GET /session-by-id"]({}, missingId, new URL("http://localhost/session-by-id"));
  assert.equal(missingId.status, 400);

  const entries = response();
  routes["GET /session-entries"]({}, entries, new URL("http://localhost/session-entries?path=folder/a.jsonl"));
  assert.deepEqual(entries.body, [{ id: "entry", path: "/sessions/folder/a.jsonl" }]);

  const messages = response();
  routes["GET /session-messages"]({}, messages, new URL("http://localhost/session-messages?path=missing"));
  assert.equal(messages.status, 404);

  const folders = response();
  routes["GET /session-folders"]({}, folders, new URL("http://localhost/session-folders?dir=/other"));
  assert.deepEqual(folders.body, { folders: ["/sessions/folder"], current: "/sessions/-other" });
});

test("search validates scope and preserves filtering options, snippets, and response shape", () => {
  const { searches, routes } = setup();
  const short = response();
  routes["GET /search"]({}, short, new URL("http://localhost/search?q=x"));
  assert.equal(short.status, 400);

  const escaped = response();
  routes["GET /search"]({}, escaped, new URL("http://localhost/search?q=find&scope=folder&path=/sessions-escape"));
  assert.equal(escaped.status, 400);

  const found = response();
  routes["GET /search"]({}, found, new URL("http://localhost/search?q=find&scope=session&path=/sessions/folder/a.jsonl&tools=1"));
  assert.equal(found.status, 200);
  assert.deepEqual(found.body, {
    q: "find",
    scope: "session",
    results: [{
      sessionId: "session-a", sessionPath: "/sessions/folder/a.jsonl", snippet: "matching text",
      sessionRef: { backend: "jsonl", id: "session-a", storagePath: "/sessions/folder/a.jsonl" },
      sessionKey: "key-session-a",
    }],
  });
  assert.deepEqual(searches, [{
    q: "find",
    scope: "session",
    path: "/sessions/folder/a.jsonl",
    includeTools: true,
    defaultDir: "/sessions/-work",
  }]);
});

test("deleting a session isolates cross-session, global, rebound, and fork resources", async () => {
  const { state, stopped, closed, unlinked, deletedCheckpoints, deletedRoutineOwners, routes } = setup();
  state.runners.set("r-fork", { id: "r-fork", sessionFile: "/sessions/folder/fork.jsonl", sessionId: "fork" });
  state.runners.set("r-other", { id: "r-other", sessionFile: "/sessions/folder/other.jsonl", sessionId: "other" });
  state.runners.set("r-global", { id: "r-global", sessionFile: null, sessionId: null });
  state.tunnels.set("t-fork", { id: "t-fork", port: 4001, sessionId: "fork" });
  state.tunnels.set("t-rebound", { id: "t-rebound", port: 4002, sessionId: "session-b" });
  state.tunnels.set("t-global", { id: "t-global", port: 4003, sessionId: null });
  const res = response();
  await routes["DELETE /session"]({}, res, new URL("http://localhost/session?path=folder/a.jsonl"));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    deleted: "/sessions/folder/a.jsonl",
    closedHublots: [4000],
    releasedRoutines: ["routine-a"],
  });
  assert.deepEqual(stopped, ["r1"]);
  assert.deepEqual(closed, ["t1"]);
  assert.deepEqual(unlinked, ["/sessions/folder/a.jsonl"]);
  assert.deepEqual(deletedCheckpoints, ["session-a"]);
  assert.deepEqual(deletedRoutineOwners, ["session-a"]);
  assert.deepEqual([...state.runners.keys()].sort(), ["r-fork", "r-global", "r-other"]);
  assert.equal(state.defaultRunnerId, null);
  assert.deepEqual([...state.tunnels.keys()].sort(), ["t-fork", "t-global", "t-rebound", "t1"]);
  assert.equal(state.runnersBroadcast, true);
});
