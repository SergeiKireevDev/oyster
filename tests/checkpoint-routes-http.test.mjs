import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointRoutes } from "../server/http/routes/checkpointRoutes.mjs";

const response = () => ({});
const rollbackJournal = (events = []) => ({
  start(input) {
    let stage = "persisted";
    events.push([stage, input]);
    return {
      get stage() { return stage; },
      advance(next, details) { stage = next; events.push([next, details]); },
      complete(details) { stage = "completed"; events.push([stage, details]); },
      fail(error) { events.push(["failed", stage, error.message]); },
    };
  },
});
const repository = (records = {}) => ({
  listBySessionId: (id) => records[id] ?? [],
  findBySessionId: (id, _backend, hash) => (records[id] ?? []).find((checkpoint) => checkpoint.hash === hash) ?? null,
  listForSession: (reference) => records[reference.id] ?? [],
  replaceForSession: (reference, checkpoints) => { records[reference.id] = checkpoints; },
  record: (_reference, checkpoint) => checkpoint,
});
test("checkpoint create/list/tree routes preserve validation, model options, persistence, and shapes", async () => {
  const calls = [], owners = [];
  const runner = { dir: "/work", sessionRef: { backend: "jsonl", id: "session", storagePath: new URL("../package.json", import.meta.url).pathname } };
  const routes = createCheckpointRoutes({
    state: {
      sessionCatalog: { backend: "jsonl" },
      sessionReferences: { serialize: () => "jsonl-key" },
      sessionOperations: { capabilities: { exactFork: { jsonl: true } } },
      piProcesses: { bin: "pi" },
    }, config: { PI_BIN: "pi" },
    requestContext: { json(res, status, body) { res.status = status; res.body = body; }, readJsonBody: async (req) => req.body },
    runnerFromReq: () => runner,
    ensureSessionOwner: (reference) => owners.push(reference),
    checkpointWorkdir: async (...args) => { calls.push(args); return { status: 200, body: { hash: "abc123", committed: true } }; },
    recordCheckpoint: () => ({ anchorId: "entry-1" }),
    checkpointRepository: repository({ session: [{ hash: "abc123" }] }),
    checkpointRollbackJournal: rollbackJournal(),
    checkpointTree: (reference) => ({ path: reference.storagePath, children: [] }),
    sessionReferenceFromSearch: (url) => url.searchParams.get("path") === "valid.jsonl" ? { backend: "jsonl", id: "session", storagePath: "/session.jsonl" } : null,
    logger: { error() {} },
  });
  const created = response(); await routes["POST /checkpoint"]({ body: { label: "save", model: "model/id" } }, created, new URL("http://localhost/checkpoint"));
  assert.equal(created.status, 200);
  assert.deepEqual(created.body, { hash: "abc123", committed: true, recorded: true, anchorId: "entry-1" });
  assert.deepEqual(calls[0], [{ bin: "pi" }, "/work", "save", "model/id"]);
  assert.deepEqual(owners, [runner.sessionRef]);
  const missing = response(); routes["GET /checkpoints"]({}, missing, new URL("http://localhost/checkpoints")); assert.equal(missing.status, 400);
  const listed = response(); routes["GET /checkpoints"]({}, listed, new URL("http://localhost/checkpoints?id=session"));
  assert.deepEqual(listed.body, { checkpoints: [{ hash: "abc123" }] });
  const invalidTree = response(); routes["GET /checkpoint-tree"]({}, invalidTree, new URL("http://localhost/checkpoint-tree?path=no")); assert.equal(invalidTree.status, 400);
  const tree = response(); routes["GET /checkpoint-tree"]({}, tree, new URL("http://localhost/checkpoint-tree?path=valid.jsonl"));
  assert.deepEqual(tree.body, {
    path: "/session.jsonl", children: [],
    capabilities: { rollback: true, reason: null },
  });
});

test("SQLite rollback capability rejection occurs before git or safety-checkpoint side effects", async () => {
  const calls = [];
  const sessionRef = { backend: "sqlite", id: "sqlite", storagePath: "/agent/sessions.sqlite" };
  const routes = createCheckpointRoutes({
    state: {
      sessionCatalog: { backend: "sqlite", findById: () => ({ id: "sqlite" }) },
      sessionOperations: { capabilities: { exactFork: { sqlite: false } } },
    },
    config: { PI_BIN: "pi" },
    requestContext: { json(res, status, body) { res.status = status; res.body = body; }, readJsonBody: async (req) => req.body },
    checkpointRepository: repository({ sqlite: [{ hash: "abc", dir: "/work", anchorId: "e1", sessionRef }] }),
    checkpointRollbackJournal: rollbackJournal(),
    git: async () => { calls.push("git"); return { code: 0, stdout: "" }; },
    checkpointWorkdir: async () => { calls.push("checkpoint"); return {}; },
  });
  const result = response();
  await routes["POST /rollback"]({ body: { sessionId: "sqlite", hash: "abc" } }, result);
  assert.equal(result.status, 409);
  assert.deepEqual(calls, []);
});

test("rollback preserves the existing fork-before-reset failure behavior and payload", async () => {
  const sessionRef = { backend: "sqlite", id: "sqlite", storagePath: "/agent/sessions.sqlite" };
  const forkRef = { backend: "sqlite", id: "fork", storagePath: "/agent/sessions.sqlite" };
  const events = [], sideEffects = [];
  const routes = createCheckpointRoutes({
    state: {
      sessionCatalog: {
        backend: "sqlite", findById: () => ({ id: "sqlite" }),
        entries: () => ({ entries: [{ id: "e1" }] }),
      },
      sessionOperations: {
        capabilities: { exactFork: { sqlite: true } },
        async forkSession() { sideEffects.push("fork"); return { id: "fork", sessionRef: forkRef }; },
      },
    },
    config: { PI_BIN: "pi" },
    requestContext: { json(res, status, body) { res.status = status; res.body = body; }, readJsonBody: async (req) => req.body },
    checkpointRepository: {
      ...repository({ sqlite: [{ hash: "abc", dir: "/work", anchorId: "e1", leafId: "e1", sessionRef }] }),
      replaceForSession() { sideEffects.push("inherit"); },
    },
    checkpointRollbackJournal: rollbackJournal(events),
    git: async (_dir, args) => args[0] === "status"
      ? { code: 0, stdout: "", stderr: "" }
      : { code: 1, stdout: "", stderr: "cannot reset" },
    checkpointWorkdir: async () => ({ status: 200, body: {} }),
    openSessionRunner() { sideEffects.push("runner"); },
    sendToRunner() {}, srvId: () => "srv", runnerInfo() {},
    logger: { error() {}, log() {} },
  });

  const result = response();
  await routes["POST /rollback"]({ body: { sessionId: "sqlite", hash: "abc" } }, result);
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: "git reset failed: cannot reset" });
  assert.deepEqual(sideEffects, ["fork"]);
  assert.deepEqual(events.map(([stage]) => stage), ["persisted", "safety_checkpointed", "session_forked", "failed"]);
});

test("SQLite rollback forks the exact entry before resetting and opens the fork by reference", async () => {
  const order = [];
  const sessionRef = { backend: "sqlite", id: "sqlite", storagePath: "/agent/sessions.sqlite" };
  const forkRef = { backend: "sqlite", id: "fork", storagePath: "/agent/sessions.sqlite" };
  const saved = [], journalEvents = [];
  const routes = createCheckpointRoutes({
    state: {
      sessionCatalog: {
        backend: "sqlite", findById: () => ({ id: "sqlite" }),
        entries: () => ({ entries: [{ id: "e1" }] }),
      },
      sessionReferences: { serialize: () => "fork-key" },
      sessionOperations: {
        capabilities: { exactFork: { sqlite: true } },
        async forkSession(_reference, options) { order.push(["fork", options.entryId]); return { id: "fork", sessionRef: forkRef }; },
      },
    },
    config: { PI_BIN: "pi" },
    requestContext: { json(res, status, body) { res.status = status; res.body = body; }, readJsonBody: async (req) => req.body },
    checkpointRepository: {
      ...repository({ sqlite: [{ hash: "abc", dir: "/work", anchorId: "e1", leafId: "e1", sessionRef }] }),
      replaceForSession: (reference, checkpoints) => saved.push({ reference, checkpoints }),
    },
    checkpointRollbackJournal: rollbackJournal(journalEvents),
    git: async (_dir, args) => { order.push(["git", args[0]]); return { code: 0, stdout: "" }; },
    checkpointWorkdir: async () => ({ status: 200, body: {} }),
    openSessionRunner: ({ sessionRef: opened }) => ({ id: "r2", sessionRef: opened }),
    sendToRunner() {}, srvId: () => "srv", runnerInfo: (runner) => ({ id: runner.id }),
    logger: { error() {}, log() {} },
  });
  const result = response();
  await routes["POST /rollback"]({ body: { sessionId: "sqlite", hash: "abc" } }, result);
  assert.equal(result.status, 200);
  assert.deepEqual(order, [["git", "status"], ["fork", "e1"], ["git", "reset"]]);
  assert.deepEqual(result.body.fork, { id: "fork", path: null, sessionRef: forkRef, sessionKey: "fork-key" });
  assert.deepEqual(saved[0].reference, forkRef);
  assert.deepEqual(saved[0].checkpoints[0].sessionRef, forkRef);
  assert.deepEqual(journalEvents.map(([stage]) => stage), [
    "persisted", "safety_checkpointed", "session_forked", "git_reset",
    "inheritance_recorded", "runner_opened", "completed",
  ]);
});

test("rollback saves dirty work, resets, forks, opens a runner, and preserves response shape", async () => {
  const sessionPath = new URL("../package.json", import.meta.url).pathname;
  const saved = [], commands = [];
  const db = { s1: [{ hash: "abc", dir: "/work", sessionPath, anchorId: "e1", leafId: "e2" }] };
  const routes = createCheckpointRoutes({
    state: {
      sessionCatalog: { backend: "jsonl" },
      sessionReferences: { serialize: () => "fork-key" },
      sessionOperations: { capabilities: { exactFork: { jsonl: true } } },
    }, config: { PI_BIN: "pi" }, requestContext: { json(r, status, body) { r.status = status; r.body = body; }, readJsonBody: async r => r.body },
    checkpointRepository: {
      ...repository(structuredClone(db)),
      replaceForSession: (reference, checkpoints) => saved.push({ reference, checkpoints }),
    },
    checkpointRollbackJournal: rollbackJournal(),
    git: async (_dir, args) => args[0] === "status" ? { code: 0, stdout: " M file" } : { code: 0, stdout: "" },
    checkpointWorkdir: async () => ({ status: 200, body: { committed: true, hash: "safety" } }), recordCheckpoint: () => ({}),
    forkSessionAt: () => ({ id: "fork", path: "/fork.jsonl", entryIds: new Set(["e1"]) }),
    openSessionRunner: options => ({ id: "r2", ...options }), sendToRunner: (_r, command) => commands.push(command),
    srvId: () => "srv", runnerInfo: runner => ({ id: runner.id }), runnerFromReq() {}, checkpointTree() {}, sessionReferenceFromSearch() {}, logger: { error() {}, log() {} },
  });
  const response = {};
  await routes["POST /rollback"]({ body: { sessionId: "s1", hash: "abc", model: "m" } }, response);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    rolledBack: "abc", safety: "safety",
    fork: {
      id: "fork", path: "/fork.jsonl",
      sessionRef: { backend: "jsonl", id: "fork", storagePath: "/fork.jsonl" },
      sessionKey: "fork-key",
    },
    runner: { id: "r2" },
  });
  assert.equal(saved[0].reference.id, "fork");
  assert.equal(saved[0].checkpoints.length, 1);
  assert.equal(commands[0].type, "set_session_name");
});
