import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createRequestContext } from "../http/createRequestContext.mjs";
import { createWorkdirRoutes } from "../http/routes/workdirRoutes.mjs";

function req(path) { const r = Readable.from([Buffer.from(JSON.stringify({ path }))]); r.headers = {}; return r; }
function res() { return { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } }; }

test("workdir validates confinement, switches state, and spawns the selected runner", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "workdir-route-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "file"); await writeFile(file, "x");
  const state = { config: { TOKEN: "x", PI_DIR: root, DIRNAME: root }, currentDir: "/old" };
  const spawned = [];
  const route = createWorkdirRoutes({
    state, requestContext: createRequestContext(state),
    spawnRunner: (options) => { spawned.push(options); return { id: "r2", ...options }; },
    runnerInfo: (runner) => ({ id: runner.id, dir: runner.dir }), logger: { log() {} },
  })["POST /workdir"];
  const forbidden = res(); await route(req("/etc"), forbidden); assert.equal(forbidden.status, 403);
  const invalid = res(); await route(req(file), invalid); assert.equal(invalid.status, 400);
  const changed = res(); await route(req(root), changed);
  assert.equal(changed.status, 200); assert.equal(state.currentDir, root);
  assert.deepEqual(spawned, [{ dir: root }]);
  assert.deepEqual(changed.body, { workdir: root, runner: { id: "r2", dir: root } });
});
