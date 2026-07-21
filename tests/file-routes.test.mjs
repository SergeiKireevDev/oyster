import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createRequestContext } from "../http/createRequestContext.mjs";
import { createFileRoutes } from "../http/routes/fileRoutes.mjs";

function res() { return { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } }; }
function req(body) { const value = Readable.from([Buffer.from(JSON.stringify(body))]); value.headers = {}; return value; }

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "file-routes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".hidden-dir"));
  await mkdir(join(root, "visible"));
  await writeFile(join(root, ".hidden.txt"), "x");
  await writeFile(join(root, "file.txt"), "data");
  const state = { config: { TOKEN: "x", PI_DIR: root, DIRNAME: root }, currentDir: root };
  return { root, routes: createFileRoutes({ state, requestContext: createRequestContext(state), logger: { log() {} } }) };
}

test("browse stays confined and reports hidden directories and optional files", async (t) => {
  const { root, routes } = await setup(t);
  const listed = res();
  routes["GET /browse"]({}, listed, new URL(`http://localhost/browse?path=${encodeURIComponent(root)}&files=1`));
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.dirs, [{ name: ".hidden-dir", hidden: true }, { name: "visible", hidden: false }]);
  assert.deepEqual(listed.body.files, [{ name: ".hidden.txt", size: 1, hidden: true }, { name: "file.txt", size: 4, hidden: false }]);

  const escaped = res();
  routes["GET /browse"]({}, escaped, new URL("http://localhost/browse?path=/etc"));
  assert.equal(escaped.status, 403);
});

test("mkdir validates names, conflicts, and creates only beneath an allowed parent", async (t) => {
  const { root, routes } = await setup(t);
  const invalid = res();
  await routes["POST /mkdir"](req({ path: root, name: "../escape" }), invalid);
  assert.equal(invalid.status, 400);

  const conflict = res();
  await routes["POST /mkdir"](req({ path: root, name: "visible" }), conflict);
  assert.equal(conflict.status, 409);

  const created = res();
  await routes["POST /mkdir"](req({ path: root, name: "created" }), created);
  assert.equal(created.status, 201);
  assert.equal(existsSync(join(root, "created")), true);
});
