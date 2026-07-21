import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointRoutes } from "../http/routes/checkpointRoutes.mjs";

const response = () => ({});
test("checkpoint create/list/tree routes preserve validation, model options, persistence, and shapes", async () => {
  const calls = [];
  const runner = { dir: "/work", sessionFile: new URL("../package.json", import.meta.url).pathname };
  const routes = createCheckpointRoutes({
    state: {}, config: { PI_BIN: "pi" },
    requestContext: { json(res, status, body) { res.status = status; res.body = body; }, readJsonBody: async (req) => req.body },
    runnerFromReq: () => runner,
    checkpointWorkdir: async (...args) => { calls.push(args); return { status: 200, body: { hash: "abc123", committed: true } }; },
    recordCheckpoint: () => ({ anchorId: "entry-1" }),
    loadCheckpoints: () => ({ session: [{ hash: "abc123" }] }),
    checkpointTree: (path) => ({ path, children: [] }),
    sessionFileParam: (url) => url.searchParams.get("path") === "valid.jsonl" ? "/session.jsonl" : null,
    logger: { error() {} },
  });
  const created = response(); await routes["POST /checkpoint"]({ body: { label: "save", model: "model/id" } }, created, new URL("http://localhost/checkpoint"));
  assert.equal(created.status, 200); assert.equal(created.body.recorded, true); assert.equal(created.body.anchorId, "entry-1");
  assert.deepEqual(calls[0], ["pi", "/work", "save", "model/id"]);
  const missing = response(); routes["GET /checkpoints"]({}, missing, new URL("http://localhost/checkpoints")); assert.equal(missing.status, 400);
  const listed = response(); routes["GET /checkpoints"]({}, listed, new URL("http://localhost/checkpoints?id=session"));
  assert.deepEqual(listed.body, { checkpoints: [{ hash: "abc123" }] });
  const invalidTree = response(); routes["GET /checkpoint-tree"]({}, invalidTree, new URL("http://localhost/checkpoint-tree?path=no")); assert.equal(invalidTree.status, 400);
  const tree = response(); routes["GET /checkpoint-tree"]({}, tree, new URL("http://localhost/checkpoint-tree?path=valid.jsonl"));
  assert.deepEqual(tree.body, { path: "/session.jsonl", children: [] });
});

test("rollback saves dirty work, resets, forks, opens a runner, and preserves response shape", async () => {
  const sessionPath = new URL("../package.json", import.meta.url).pathname;
  const saved = [], commands = [];
  const db = { s1: [{ hash: "abc", dir: "/work", sessionPath, anchorId: "e1", leafId: "e2" }] };
  const routes = createCheckpointRoutes({
    state: {}, config: { PI_BIN: "pi" }, requestContext: { json(r, status, body) { r.status = status; r.body = body; }, readJsonBody: async r => r.body },
    loadCheckpoints: () => structuredClone(db), saveCheckpoints: value => saved.push(value),
    git: async (_dir, args) => args[0] === "status" ? { code: 0, stdout: " M file" } : { code: 0, stdout: "" },
    checkpointWorkdir: async () => ({ status: 200, body: { committed: true, hash: "safety" } }), recordCheckpoint: () => ({}),
    forkSessionAt: () => ({ id: "fork", path: "/fork.jsonl", entryIds: new Set(["e1"]) }),
    openSessionRunner: options => ({ id: "r2", ...options }), sendToRunner: (_r, command) => commands.push(command),
    srvId: () => "srv", runnerInfo: runner => ({ id: runner.id }), runnerFromReq() {}, checkpointTree() {}, sessionFileParam() {}, logger: { error() {}, log() {} },
  });
  const response = {};
  await routes["POST /rollback"]({ body: { sessionId: "s1", hash: "abc", model: "m" } }, response);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { rolledBack: "abc", safety: "safety", fork: { id: "fork", path: "/fork.jsonl" }, runner: { id: "r2" } });
  assert.equal(saved[0].fork.length, 1);
  assert.equal(commands[0].type, "set_session_name");
});
