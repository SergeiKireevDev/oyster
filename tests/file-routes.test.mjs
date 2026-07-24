import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createRequestContext } from "../server/http/createRequestContext.mjs";
import { createFileRoutes } from "../server/http/routes/fileRoutes.mjs";

function res() { return { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } }; }
function req(body) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const value = Readable.from([Buffer.from(payload)]);
  value.headers = {};
  return value;
}

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

test("file content and save routes enforce confinement and preserve text contracts", async (t) => {
  const { root, routes } = await setup(t);
  const content = res();
  routes["GET /file-content"]({}, content, new URL(`http://localhost/file-content?path=${encodeURIComponent(join(root, "file.txt"))}`));
  assert.deepEqual(content.body, { path: join(root, "file.txt"), content: "data" });

  const escaped = res();
  routes["GET /file-content"]({}, escaped, new URL("http://localhost/file-content?path=/etc/passwd"));
  assert.equal(escaped.status, 403);

  const saved = res();
  await routes["POST /file-save"](req({ path: join(root, "file.txt"), content: "changed" }), saved);
  assert.equal(saved.status, 200);
  assert.equal(readFileSync(join(root, "file.txt"), "utf8"), "changed");
});

test("chunked upload enforces ordered offsets and makes final retries idempotent", async (t) => {
  const { root, routes } = await setup(t);
  const first = res();
  await routes["POST /file-upload"](req("abc"), first, new URL(`http://localhost/file-upload?dir=${encodeURIComponent(root)}&name=upload.txt&offset=0&last=0`));
  assert.deepEqual(first.body, { received: 3 });

  const wrong = res();
  await routes["POST /file-upload"](req("xx"), wrong, new URL(`http://localhost/file-upload?dir=${encodeURIComponent(root)}&name=upload.txt&offset=2&last=1`));
  assert.equal(wrong.status, 409);

  const final = res();
  await routes["POST /file-upload"](req("def"), final, new URL(`http://localhost/file-upload?dir=${encodeURIComponent(root)}&name=upload.txt&offset=3&last=1`));
  assert.deepEqual(final.body, { saved: join(root, "upload.txt"), bytes: 6 });
  assert.equal(readFileSync(join(root, "upload.txt"), "utf8"), "abcdef");

  const retried = res();
  await routes["POST /file-upload"](req("def"), retried, new URL(`http://localhost/file-upload?dir=${encodeURIComponent(root)}&name=upload.txt&offset=3&last=1`));
  assert.deepEqual(retried.body, { saved: join(root, "upload.txt"), bytes: 6 });
});

test("an interrupted chunk preserves the last completed upload offset", async (t) => {
  const { root, routes } = await setup(t);
  const first = res();
  await routes["POST /file-upload"](req("abc"), first, new URL(`http://localhost/file-upload?dir=${encodeURIComponent(root)}&name=interrupted.bin&offset=0&last=0`));
  assert.deepEqual(first.body, { received: 3 });

  const interruptedReq = Readable.from((async function* () {
    yield Buffer.from("def");
    throw new Error("browser disconnected");
  })());
  interruptedReq.headers = {};
  const interrupted = res();
  await routes["POST /file-upload"](interruptedReq, interrupted, new URL(`http://localhost/file-upload?dir=${encodeURIComponent(root)}&name=interrupted.bin&offset=3&last=1`));
  assert.equal(interrupted.status, 413);
  assert.equal(readFileSync(join(root, ".interrupted.bin.upload"), "utf8"), "abc");

  const resumed = res();
  await routes["POST /file-upload"](req("def"), resumed, new URL(`http://localhost/file-upload?dir=${encodeURIComponent(root)}&name=interrupted.bin&offset=3&last=1`));
  assert.deepEqual(resumed.body, { saved: join(root, "interrupted.bin"), bytes: 6 });
  assert.equal(readFileSync(join(root, "interrupted.bin"), "utf8"), "abcdef");
});

test("upload cleanup removes only abandoned temporary files", async (t) => {
  const { root, routes } = await setup(t);
  const stale = join(root, ".stale.bin.upload");
  const fresh = join(root, ".fresh.bin.upload");
  await writeFile(stale, "old");
  await writeFile(fresh, "active");
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await utimes(stale, old, old);

  const uploaded = res();
  await routes["POST /file-upload"](req("new"), uploaded, new URL(`http://localhost/file-upload?dir=${encodeURIComponent(root)}&name=new.bin&offset=0&last=1`));
  assert.equal(uploaded.status, 200);
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(fresh), true);
  assert.equal(readFileSync(join(root, "new.bin"), "utf8"), "new");
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
