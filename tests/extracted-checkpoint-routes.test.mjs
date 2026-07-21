import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../app.mjs", import.meta.url), "utf8");
const factory = readFileSync(new URL("../http/routes/checkpointRoutes.mjs", import.meta.url), "utf8");

test("checkpoint factory receives explicit git, session, and runner operations", () => {
  assert.match(app, /createCheckpointRoutes\(\{[\s\S]*?git, saveCheckpoints, forkSessionAt, openSessionRunner, sendToRunner,[\s\S]*?srvId, runnerInfo,/);
  assert.equal(factory.includes('from "../../app.mjs"'), false);
});

test("app contains no checkpoint route bodies", () => {
  for (const route of ["POST /checkpoint", "GET /checkpoints", "GET /checkpoint-tree", "POST /rollback"]) {
    assert.equal(app.includes(`"${route}":`), false, `stale checkpoint route: ${route}`);
  }
  assert.match(app, /checkpoint: checkpointRoutes/);
});
