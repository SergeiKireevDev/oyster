import test from "node:test";
import assert from "node:assert/strict";
import { createSessionRoutes } from "../server/http/routes/sessionRoutes.mjs";
import { createThreadRoutes } from "../server/http/routes/threadRoutes.mjs";
import { threadBoundaryIndex, threadError } from "../server/threads.mjs";

const response = () => ({ setHeader() {} });
const reference = (id) => ({ backend: "sqlite", id, storagePath: "/agent/sessions.sqlite" });
const codec = {
  serialize: (value) => `key-${value.id}`,
  parse(key) {
    if (!String(key).startsWith("key-")) throw new Error("invalid session key format");
    return reference(String(key).slice("key-".length));
  },
  validate: (value) => value,
  equals: (left, right) => left.backend === right.backend && left.id === right.id,
};
const requestContext = {
  json(res, status, body) { res.status = status; res.body = body; },
  readJsonBody: async (req) => req.body,
};

test("thread routes list a family, create threads, and delete through the session route", async () => {
  const calls = [];
  const row = { id: "t1", session_id: "fork" };
  const threads = {
    tree: async (sessionRef) => ({ rootSessionKey: "key-root", currentThreadId: null, root: { sessionId: sessionRef.id }, threads: [] }),
    async create(sessionRef, body) {
      if (body.question === "when") throw threadError(400, "question must be one of why, what, how, other");
      calls.push(["create", sessionRef.id, body.quote]);
      return { thread: { id: "t1" }, runner: { id: "r1" }, queued: true };
    },
    find: async (id) => id === "t1" ? row : null,
    sessionReference: () => reference("fork"),
    describe: () => ({ id: "t1", parentSessionKey: "key-root" }),
    forget: (ids) => calls.push(["forget", ...ids]),
  };
  const routes = createThreadRoutes({
    state: { sessionReferences: codec }, requestContext, threads,
    deleteSession: async (sessionKey) => { calls.push(["delete", sessionKey]); return { status: 200, data: {} }; },
  });

  const listed = response();
  await routes["GET /threads"]({}, listed, new URL("http://localhost/threads?key=key-root"));
  assert.equal(listed.status, 200);
  assert.equal(listed.body.root.sessionId, "root");

  const invalid = response();
  await routes["GET /threads"]({}, invalid, new URL("http://localhost/threads?key=nope"));
  assert.deepEqual([invalid.status, invalid.body], [400, { error: "a valid session key is required" }]);

  const created = response();
  await routes["POST /threads"]({ body: { sessionKey: "key-root", quote: "the plan", question: "why", anchorEntryId: "a1" } }, created);
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, { thread: { id: "t1" }, runner: { id: "r1" }, queued: true });

  // Service errors keep the status they were raised with.
  const rejected = response();
  await routes["POST /threads"]({ body: { sessionKey: "key-root", question: "when" } }, rejected);
  assert.deepEqual([rejected.status, rejected.body], [400, { error: "question must be one of why, what, how, other" }]);

  const deleted = response();
  await routes["DELETE /threads"]({}, deleted, new URL("http://localhost/threads?id=t1"));
  assert.deepEqual([deleted.status, deleted.body], [200, { deleted: "t1", parentSessionKey: "key-root" }]);
  const missing = response();
  await routes["DELETE /threads"]({}, missing, new URL("http://localhost/threads?id=nope"));
  assert.equal(missing.status, 404);
  assert.deepEqual(calls, [["create", "root", "the plan"], ["delete", "key-fork"], ["forget", "t1"]]);
});

test("a failed session deletion is reported and leaves the thread registered", async () => {
  const forgotten = [];
  const routes = createThreadRoutes({
    state: { sessionReferences: codec }, requestContext,
    threads: {
      tree: async () => ({}), create: async () => ({}), find: async () => ({ id: "t1" }),
      sessionReference: () => reference("fork"), describe: () => ({}), forget: (ids) => forgotten.push(...ids),
    },
    deleteSession: async () => ({ status: 409, data: { error: "sqlite session deletion is not supported by the configured pi" } }),
  });
  const res = response();
  await routes["DELETE /threads"]({}, res, new URL("http://localhost/threads?id=t1"));
  assert.deepEqual([res.status, res.body], [409, { error: "sqlite session deletion is not supported by the configured pi" }]);
  assert.deepEqual(forgotten, []);
});

function sessionSetup({ messages = [], rows = [], descendants = {} } = {}) {
  const deleted = [];
  const stopped = [];
  const forgotten = [];
  const archivedOwners = [];
  const state = {
    currentDir: "/work",
    runners: new Map([["r-fork", { id: "r-fork", sessionRef: reference("fork"), proc: {} }]]),
    sessionReferences: codec,
    appStore: { repositories: { sessions: {
      upsert: async () => ({ id: 1, archived: 0 }),
      find: async ({ sessionId }) => ({ id: sessionId, archived: 0 }),
      setArchived: async (id, archived) => { archivedOwners.push([id, archived]); return 1; },
    } } },
  };
  const threads = {
    list: async () => rows,
    describe: (row) => ({ id: row.id, sessionKey: `key-${row.session_id}`, parentSessionKey: `key-${row.parent}`, rootSessionKey: "key-root" }),
    findBySession: async (sessionRef) => rows.find((row) => row.session_id === sessionRef.id) ?? null,
    descendants: async (sessionRef) => (descendants[sessionRef.id] ?? []).map((id) => ({ id: `t-${id}`, reference: reference(id) })),
    forget: (ids) => forgotten.push(...ids),
    boundaryIndex: (list, row) => threadBoundaryIndex(list, { forkEntryId: row.fork_entry_id, prompt: row.prompt, promptOrdinal: 0 }),
  };
  const routes = createSessionRoutes({
    state,
    requestContext,
    threads,
    sessions: { catalog: {
      backend: "sqlite", storagePath: "/agent/sessions.sqlite",
      list: async () => [{ id: "root", cwd: "/work" }, { id: "fork", cwd: "/work", parentSessionId: "root" }],
      messages: async (id) => ({ sessionId: id, messages }),
      findById: async (id) => ({ id }),
      family: async (id) => [{ id }],
      search: async () => ({ results: [{ sessionId: "fork", snippet: "hit" }] }),
    } },
    runners: { stopRunner: async (runner) => { stopped.push(runner.id); }, runnersChanged() {} },
    resources: { closeSessionHublots: async () => [], stopSessionRoutines: async () => [], deleteSessionRoutines: async () => [] },
    sessionOperations: {
      capabilities: { delete: { sqlite: true } },
      async deleteSession(sessionRef) {
        if (sessionRef.id === "ghost") throw Object.assign(new Error("Session not found: ghost"), { code: "not_found" });
        deleted.push(sessionRef.id);
        return { deleted: sessionRef.id };
      },
    },
  });
  return { routes, state, deleted, stopped, forgotten, archivedOwners };
}

test("session listings and search hits carry thread lineage", async () => {
  const { routes } = sessionSetup({ rows: [{ id: "t1", session_id: "fork", parent: "root" }] });
  const listed = response();
  await routes["GET /sessions"]({}, listed, new URL("http://localhost/sessions?all=1"));
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.sessions.map((session) => [session.id, session.thread]), [
    ["root", null],
    ["fork", { id: "t1", parentSessionKey: "key-root", rootSessionKey: "key-root" }],
  ]);
  assert.equal(listed.body.sessions[1].runnerId, "r-fork");

  const found = response();
  await routes["GET /search"]({}, found, new URL("http://localhost/search?q=hit&scope=all"));
  assert.deepEqual(found.body.results[0].thread, { id: "t1", parentSessionKey: "key-root", rootSessionKey: "key-root" });
});

test("a thread transcript starts at its fork and pages back into inherited history on request", async () => {
  const prompt = "> quoted\n\nWhy? Explain the reasoning behind the quoted passage.";
  const inherited = Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `inherited ${index}`, entryId: `e${index}` }));
  const own = [{ role: "user", content: prompt, entryId: "own-0" }, { role: "assistant", content: "because", entryId: "own-1" }];
  const rows = [{ id: "t1", session_id: "fork", parent: "root", fork_entry_id: "e5", prompt, created_at: "2026-11-22T10:00:00.000Z" }];
  const { routes } = sessionSetup({ messages: [...inherited, ...own], rows });
  const fetchPage = async (query) => {
    const res = response();
    await routes["GET /session-messages"]({}, res, new URL(`http://localhost/session-messages?${query}`));
    assert.equal(res.status, 200);
    return res.body;
  };

  // The newest page holds only what the thread wrote, and points at the fork.
  const first = await fetchPage("key=key-fork&limit=80");
  assert.deepEqual(first.messages.map((message) => message.entryId), ["own-0", "own-1"]);
  assert.deepEqual(first.page, { before: 6, hasMore: true, total: 8, threadStart: true });
  assert.deepEqual(first.thread, { id: "t1", boundary: 6, createdAt: "2026-11-22T10:00:00.000Z" });

  // Paging back from the fork returns the inherited context, flagged as such.
  const context = await fetchPage("key=key-fork&limit=80&before=6");
  assert.deepEqual(context.messages.map((message) => [message.entryId, message.inherited]), inherited.map((message) => [message.entryId, true]));
  assert.deepEqual(context.page, { before: null, hasMore: false, total: 8 });

  // An unpaged read returns everything, still telling the two apart.
  const full = await fetchPage("key=key-fork");
  assert.deepEqual(full.messages.map((message) => Boolean(message.inherited)), [true, true, true, true, true, true, false, false]);

  // Ordinary sessions are untouched.
  const ordinary = await fetchPage("key=key-root&limit=80");
  assert.equal(ordinary.thread, undefined);
  assert.equal(ordinary.messages.length, 8);
  assert.equal(ordinary.messages.some((message) => message.inherited), false);
});

test("a thread that has not answered yet shows no inherited messages on its first page", async () => {
  const inherited = [{ role: "user", content: "start", entryId: "e0" }, { role: "assistant", content: "quoted", entryId: "e1" }];
  const { routes } = sessionSetup({ messages: inherited, rows: [{ id: "t1", session_id: "fork", parent: "root", fork_entry_id: "e1", prompt: "> quoted\n\nwhy", created_at: "now" }] });
  const res = response();
  await routes["GET /session-messages"]({}, res, new URL("http://localhost/session-messages?key=key-fork&limit=80"));
  assert.deepEqual(res.body.messages, []);
  assert.deepEqual(res.body.page, { before: 2, hasMore: true, total: 2, threadStart: true });
});

test("deleting a session deletes its threads first and tolerates forks that never materialized", async () => {
  const rows = [{ id: "t-fork", session_id: "fork", parent: "root" }];
  const { routes, deleted, stopped, forgotten } = sessionSetup({ rows, descendants: { root: ["ghost", "fork"], fork: ["ghost"] } });

  const res = response();
  await routes["DELETE /session"]({}, res, new URL("http://localhost/session?key=key-root"));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.deletedThreads, ["t-ghost", "t-fork"]);
  assert.deepEqual(deleted, ["fork", "root"]);
  assert.deepEqual(stopped, ["r-fork"]);
  assert.deepEqual(forgotten, ["t-ghost", "t-fork"]);

  // Deleting one thread removes what hangs from it and then the thread itself.
  const second = sessionSetup({ rows, descendants: { fork: ["ghost"] } });
  const threadRes = response();
  await second.routes["DELETE /session"]({}, threadRes, new URL("http://localhost/session?key=key-fork"));
  assert.equal(threadRes.status, 200);
  assert.deepEqual(second.deleted, ["fork"]);
  assert.deepEqual(second.forgotten, ["t-ghost", "t-fork"]);
});

test("a missing ordinary session still fails deletion", async () => {
  const { routes } = sessionSetup();
  const res = response();
  await routes["DELETE /session"]({}, res, new URL("http://localhost/session?key=key-ghost"));
  assert.equal(res.status, 500);
  assert.match(res.body.error, /failed to delete session: Session not found: ghost/);
});

test("archiving a session archives and stops the threads only the registry knows about", async () => {
  const { routes, archivedOwners, stopped } = sessionSetup({ descendants: { root: ["fork"] } });
  const res = response();
  await routes["POST /session/archive"]({ body: { sessionKey: "key-root", archived: true } }, res);
  assert.equal(res.status, 200);
  assert.deepEqual(archivedOwners, [["root", true], ["fork", true]]);
  assert.deepEqual(stopped, ["r-fork"]);
});
