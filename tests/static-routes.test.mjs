import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { createRequestContext } from "../http/createRequestContext.mjs";
import { createStaticRoutes } from "../http/routes/staticRoutes.mjs";

class Response extends Writable {
  constructor() { super(); this.chunks = []; }
  _write(chunk, _encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  get body() { return Buffer.concat(this.chunks).toString("utf8"); }
}

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "static-routes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "public"));
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "public", "index.html"), "development UI");
  await writeFile(join(root, "dist", "index.html"), "built UI");
  await writeFile(join(root, "dist", "app.JS"), "export const built = true;");
  const state = { config: { TOKEN: "token", PI_DIR: root, DIRNAME: root } };
  const routes = createStaticRoutes({ config: state.config, requestContext: createRequestContext(state) });
  return { root, handler: routes["GET /*"] };
}

async function invoke(handler, pathname) {
  const res = new Response();
  const handled = handler({}, res, { pathname });
  if (handled && !res.writableFinished) await once(res, "finish");
  return { handled, res };
}

test("static document routes serve the Vite build for root and permalinks", async (t) => {
  const { handler } = await setup(t);
  for (const pathname of ["/", "/s/session-1", "/s/session-1/m/entry.2"]) {
    const { handled, res } = await invoke(handler, pathname);
    assert.equal(handled, true);
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(res.headers["cache-control"], "no-cache");
    assert.equal(res.body, "built UI");
  }
});

test("public assets preserve MIME and no-cache headers", async (t) => {
  const { handler } = await setup(t);
  const { handled, res } = await invoke(handler, "/app.JS");
  assert.equal(handled, true);
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "text/javascript; charset=utf-8");
  assert.equal(res.headers["cache-control"], "no-cache");
  assert.equal(res.body, "export const built = true;");
});

test("static fallback rejects traversal, malformed encoding, directories, and missing files", async (t) => {
  const { handler } = await setup(t);
  assert.equal((await invoke(handler, "/%2e%2e/secret")).handled, false);
  assert.equal((await invoke(handler, "/%E0%A4%A")).handled, false);
  assert.equal((await invoke(handler, "/assets")).handled, false);
  assert.equal((await invoke(handler, "/missing.js")).handled, false);
});
