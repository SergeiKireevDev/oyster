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
    sessionFileParam: (path) => path === "valid.jsonl" ? "/session.jsonl" : null,
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
