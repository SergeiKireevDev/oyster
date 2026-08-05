import test from "node:test";
import assert from "node:assert/strict";
import { createSessionRoutes } from "../server/http/routes/sessionRoutes.mjs";

function setup() {
  const stopped = [];
  const closed = [];
  const unlinked = [];
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
        messages: (path) => ({ sessionId: "session-a", messages: Array.from({ length: 5 }, (_, index) => ({ role: "user", content: `${path}:${index}` })) }),
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
      listTunnels: (_state) => [...state.tunnels.values()],
      releaseSessionRoutines: (_state, id) => { deletedRoutineOwners.push(id); return ["routine-a"]; },
    },
    resolvePath: (path) => path,
    unlinkFile: (path) => unlinked.push(path),
    logger: { log() {} },
  };
  return { state, dependencies, stopped, closed, unlinked, deletedRoutineOwners, searches, routes: createSessionRoutes(dependencies) };
}

function response() { return {}; }

test("session listing preserves root scope and live runner annotations", async () => {
  const { routes } = setup();
  const escaped = response();
  await routes["GET /sessions"]({}, escaped, new URL("http://localhost/sessions?path=/sessions-escape"));
  assert.equal(escaped.status, 400);

  const listed = response();
  await routes["GET /sessions"]({}, listed, new URL("http://localhost/sessions?path=/sessions/folder"));
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.sessions[0], {
    id: "session-a",
    path: "/sessions/folder/a.jsonl",
    dir: "/sessions/folder",
    archived: false,
    runnerId: "r1",
    alive: true,
    busy: true,
    sessionRef: { backend: "jsonl", id: "session-a", storagePath: "/sessions/folder/a.jsonl" },
    sessionKey: "key-session-a",
    parentSession: null,
    parentSessionKey: null,
  });
});

test("session catalog failures return bounded HTTP errors", async () => {
  const { dependencies, routes } = setup();
  dependencies.sessions.catalog.list = () => { throw "catalog offline"; };
  const listed = response();
  await routes["GET /sessions"]({}, listed, new URL("http://localhost/sessions"));
  assert.deepEqual(listed, { status: 500, body: { error: "failed to list sessions: catalog offline" } });

  dependencies.sessions.catalog.folders = () => { throw new Error("folder index corrupt"); };
  const folders = response();
  await routes["GET /session-folders"]({}, folders, new URL("http://localhost/session-folders"));
  assert.deepEqual(folders, { status: 500, body: { error: "failed to list session folders: folder index corrupt" } });
});

test("session lookup, entries, messages, and folders preserve response shapes", async () => {
  const { routes } = setup();
  const lookup = response();
  await routes["GET /session-by-id"]({}, lookup, new URL("http://localhost/session-by-id?id=session-a"));
  assert.deepEqual(lookup.body, { session: {
    path: "/sessions/folder/a.jsonl", id: "session-a", name: "A", archived: false,
    sessionRef: { backend: "jsonl", id: "session-a", storagePath: "/sessions/folder/a.jsonl" },
    sessionKey: "key-session-a",
    parentSession: null,
    parentSessionKey: null,
  } });

  const missingId = response();
  await routes["GET /session-by-id"]({}, missingId, new URL("http://localhost/session-by-id"));
  assert.equal(missingId.status, 400);

  const entries = response();
  await routes["GET /session-entries"]({}, entries, new URL("http://localhost/session-entries?path=folder/a.jsonl"));
  assert.deepEqual(entries.body, [{ id: "entry", path: "/sessions/folder/a.jsonl" }]);

  const messages = response();
  await routes["GET /session-messages"]({}, messages, new URL("http://localhost/session-messages?path=missing"));
  assert.equal(messages.status, 404);

  const folders = response();
  await routes["GET /session-folders"]({}, folders, new URL("http://localhost/session-folders?dir=/other"));
  assert.deepEqual(folders.body, { folders: ["/sessions/folder"], current: "/sessions/-other" });
});

test("session messages support bounded backward pages", async () => {
  const { routes } = setup();
  const latest = response();
  await routes["GET /session-messages"]({}, latest, new URL("http://localhost/session-messages?path=folder/a.jsonl&limit=2"));
  assert.deepEqual(latest.body.messages.map(({ content }) => content), [
    "/sessions/folder/a.jsonl:3", "/sessions/folder/a.jsonl:4",
  ]);
  assert.deepEqual(latest.body.page, { before: 3, hasMore: true, total: 5 });

  const earlier = response();
  await routes["GET /session-messages"]({}, earlier, new URL("http://localhost/session-messages?path=folder/a.jsonl&limit=2&before=3"));
  assert.deepEqual(earlier.body.messages.map(({ content }) => content), [
    "/sessions/folder/a.jsonl:1", "/sessions/folder/a.jsonl:2",
  ]);
  assert.deepEqual(earlier.body.page, { before: 1, hasMore: true, total: 5 });

  const invalid = response();
  await routes["GET /session-messages"]({}, invalid, new URL("http://localhost/session-messages?path=folder/a.jsonl&limit=201"));
  assert.equal(invalid.status, 400);
});

test("session message pages extend backward to the next user prompt", async () => {
  const { dependencies, routes } = setup();
  dependencies.sessions.catalog.messages = () => ({
    sessionId: "session-a",
    messages: [
      { role: "user", content: "prompt" },
      { role: "assistant", content: "thinking" },
      { role: "toolResult", content: "result" },
      { role: "assistant", content: "answer" },
    ],
  });
  const page = response();
  await routes["GET /session-messages"]({}, page, new URL("http://localhost/session-messages?path=folder/a.jsonl&limit=2"));
  assert.deepEqual(page.body.messages.map(({ content }) => content), ["prompt", "thinking", "result", "answer"]);
  assert.deepEqual(page.body.page, { before: null, hasMore: false, total: 4 });
});

test("search validates scope and preserves filtering options, snippets, and response shape", async () => {
  const { searches, routes } = setup();
  const short = response();
  await routes["GET /search"]({}, short, new URL("http://localhost/search?q=xy"));
  assert.equal(short.status, 400);
  assert.deepEqual(short.body, { error: "query must be at least 3 characters" });

  const escaped = response();
  await routes["GET /search"]({}, escaped, new URL("http://localhost/search?q=find&scope=folder&path=/sessions-escape"));
  assert.equal(escaped.status, 400);

  const found = response();
  await routes["GET /search"]({}, found, new URL("http://localhost/search?q=find&scope=session&path=/sessions/folder/a.jsonl&tools=1"));
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

test("JSONL session archive and unarchive cascade through nested children", async () => {
  const summaries = [
    { id: "root", path: "/sessions/folder/root.jsonl", parentSession: null },
    { id: "child", path: "/sessions/folder/child.jsonl", parentSession: "/sessions/folder/root.jsonl" },
    { id: "nested", path: "/sessions/folder/nested.jsonl", parentSession: "/sessions/folder/child.jsonl" },
    { id: "other", path: "/sessions/folder/other.jsonl", parentSession: null },
  ];
  const owners = new Map();
  let nextOwnerId = 1;
  const repository = {
    upsert({ backend, sessionId, storagePath }) {
      if (!owners.has(storagePath)) owners.set(storagePath, { id: nextOwnerId++, backend, session_id: sessionId, storage_path: storagePath, archived: 0 });
      return owners.get(storagePath);
    },
    find({ storagePath }) { return owners.get(storagePath) ?? null; },
    setArchived(id, archived) {
      const owner = [...owners.values()].find((candidate) => candidate.id === id);
      owner.archived = archived ? 1 : 0;
    },
  };
  const routes = createSessionRoutes({
    state: {
      currentDir: "/work",
      runners: new Map(),
      sessionReferences: {
        serialize: (reference) => `key-${reference.id}`,
        parse: (key) => {
          const id = key.replace(/^key-/, "");
          const session = summaries.find((candidate) => candidate.id === id);
          return { backend: "jsonl", id, storagePath: session.path };
        },
        equals: () => false,
      },
      appStore: { repositories: { sessions: repository } },
    },
    requestContext: {
      json(res, status, body) { res.status = status; res.body = body; },
      async readJsonBody(req) { return req.body; },
    },
    sessions: {
      catalog: {
        backend: "jsonl", root: "/sessions",
        list: () => summaries,
        folders: () => [{ dir: "/sessions/folder" }],
      },
      sessionReferenceFor: (session) => ({ backend: "jsonl", id: session.id, storagePath: session.path }),
      sessionTargetFromSearch() {},
      readSessionHeaderInfo() {},
    },
    runners: { stopRunner() {}, runnersChanged() {} },
    resources: { closeTunnel() {}, releaseSessionRoutines() {} },
    resolvePath: (path) => path,
  });
  const listed = response();
  await routes["GET /sessions"]({}, listed, new URL("http://localhost/sessions?path=/sessions/folder"));

  const invalidBody = response();
  await routes["POST /session/archive"]({ body: null }, invalidBody);
  assert.deepEqual(invalidBody, { status: 400, body: { error: "request body must be a JSON object" } });

  for (const archived of [true, false]) {
    const res = response();
    await routes["POST /session/archive"]({ body: { sessionKey: "key-root", archived } }, res);
    assert.deepEqual(res.body, { sessionKey: "key-root", archived });
    for (const path of ["root", "child", "nested"].map((id) => `/sessions/folder/${id}.jsonl`)) {
      assert.equal(Boolean(owners.get(path).archived), archived);
    }
    assert.equal(Boolean(owners.get("/sessions/folder/other.jsonl").archived), false);
  }
});

test("deleting a session isolates cross-session, global, rebound, and fork resources", async () => {
  const { state, stopped, closed, unlinked, deletedRoutineOwners, routes } = setup();
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
  assert.deepEqual(deletedRoutineOwners, ["session-a"]);
  assert.deepEqual([...state.runners.keys()].sort(), ["r-fork", "r-global", "r-other"]);
  assert.equal(state.defaultRunnerId, null);
  assert.deepEqual([...state.tunnels.keys()].sort(), ["t-fork", "t-global", "t-rebound", "t1"]);
  assert.equal(state.runnersBroadcast, true);
});
