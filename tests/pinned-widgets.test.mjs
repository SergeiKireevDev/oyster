import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { createRequestContext } from "../server/http/createRequestContext.mjs";
import { openAppStore } from "../server/persistence/appStore.mjs";
import {
  classifyPinnedPath,
  createPinnedWidgetRoutes,
  ensurePinnedHublot,
  listPinnedWidgets,
} from "../server/pinned-widgets.mjs";

function fixture(t, routeOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "oyster-pinned-widgets-"));
  const appStore = openAppStore({ databasePath: join(root, "oyster.sqlite") });
  const state = {
    appStore,
    currentDir: root,
    config: { TOKEN: "test", PI_DIR: root, DIRNAME: root },
    serverEvent() {},
  };
  const requestContext = createRequestContext(state);
  const ensureSessionOwner = (sessionId) => appStore.repositories.sessions.upsert({
    backend: "sqlite", sessionId, storagePath: join(root, "agent.sqlite"), createdAt: "created",
  });
  const routes = createPinnedWidgetRoutes({ state, requestContext, ensureSessionOwner, listTunnels: () => [], ...routeOptions });
  t.after(() => { appStore.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, state, appStore, requestContext, routes, ensureSessionOwner };
}

function request(body, headers = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = headers;
  return req;
}

function response() {
  return {
    headers: {},
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(body = "") { this.raw = body; this.body = body ? JSON.parse(body) : null; this.writableEnded = true; },
  };
}

function streamResponse() {
  const res = new PassThrough();
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.writeHead = (status, headers = {}) => { res.status = status; res.headers = headers; };
  res.body = () => Buffer.concat(chunks);
  return res;
}

test("pinned widget repository persists scoped groups and ordered artifacts", (t) => {
  const { root, appStore, ensureSessionOwner } = fixture(t);
  const owner = ensureSessionOwner("session-a");
  const repository = appStore.repositories.pinnedWidgets;
  assert.equal(repository.find("builtin:file-explorer").kind, "builtin");
  const group = repository.createGroup({ id: "group-a", ownerId: owner.id, scope: "session", name: "Results", position: 0, createdAt: "now" });
  writeFileSync(join(root, "report.md"), "# Result");
  const widget = repository.create({
    id: "widget-a", ownerId: owner.id, scope: "session", groupId: group.id,
    kind: "markdown", label: "Report", position: 0, target: join(root, "report.md"),
    mimeType: "text/markdown; charset=utf-8", size: 8, mtimeMs: 1, createdAt: "now",
  });
  assert.equal(repository.find(widget.id).session_id, "session-a");
  assert.equal(repository.nextPosition({ ownerId: owner.id, scope: "session", groupId: group.id }), 1);
  appStore.repositories.sessions.delete(owner.id);
  assert.equal(repository.find(widget.id), null);
  assert.equal(repository.findGroup(group.id), null);
  assert.ok(repository.find("builtin:file-explorer"));
});

test("live interfaces receive one durable widget and preserve closed state", (t) => {
  const { appStore, state } = fixture(t);
  const hublot = appStore.repositories.hublots.create({
    id: "live-a", port: 4173, label: "Dashboard", workdir: "/tmp",
    serviceKind: "self_served", status: "open", desiredState: "open", createdAt: "created",
  });
  const first = ensurePinnedHublot(state, hublot);
  const second = ensurePinnedHublot(state, hublot);
  assert.equal(first.id, second.id);
  assert.equal(appStore.repositories.pinnedWidgets.list().filter((row) => row.hublot_id === hublot.id).length, 1);
  appStore.repositories.hublots.update(hublot.id, { status: "closed", desired_state: "closed", public_url: null });
  const listed = listPinnedWidgets(state, { resolveSafePath: (path) => path, listTunnels: () => [] });
  assert.equal(listed.widgets.find((widget) => widget.id === first.id).availability, "closed");
});

test("widget routes classify files, render Markdown natively, group, move, and unpin", async (t) => {
  const { root, routes } = fixture(t);
  writeFileSync(join(root, "notes.md"), "# Native\n\nMarkdown");
  mkdirSync(join(root, "media"));
  writeFileSync(join(root, "media", "photo.png"), Buffer.from([1, 2, 3]));

  const created = response();
  await routes["POST /pinned-widgets"](request({ path: join(root, "notes.md"), sessionId: "session-a" }), created);
  assert.equal(created.status, 201);
  assert.equal(created.body.widget.kind, "markdown");
  assert.equal(created.body.widget.availability, "ready");

  const content = response();
  routes["GET /pinned-widget-content"]({}, content, new URL(`http://localhost/pinned-widget-content?id=${created.body.widget.id}`));
  assert.equal(content.body.content, "# Native\n\nMarkdown");

  const grouped = response();
  await routes["POST /pinned-widget-groups"](request({ name: "Reading", sessionId: "session-a" }), grouped);
  assert.equal(grouped.status, 201);

  const moved = response();
  await routes["PATCH /pinned-widgets"](request({ id: created.body.widget.id, groupId: grouped.body.group.id, sessionId: "session-a" }), moved);
  assert.equal(moved.body.widget.groupId, grouped.body.group.id);

  const removed = response();
  routes["DELETE /pinned-widgets"]({}, removed, new URL(`http://localhost/pinned-widgets?id=${created.body.widget.id}`));
  assert.equal(removed.status, 200);
});

test("media route streams safe ranges by widget identity", async (t) => {
  const { root, routes } = fixture(t);
  const bytes = Buffer.from("0123456789");
  const path = join(root, "clip.mp4");
  writeFileSync(path, bytes);
  assert.deepEqual(classifyPinnedPath(path), { kind: "video", mimeType: "video/mp4" });

  const created = response();
  await routes["POST /pinned-widgets"](request({ path, scope: "workspace" }), created);
  const req = new PassThrough();
  req.headers = { range: "bytes=2-5" };
  const res = streamResponse();
  const finished = new Promise((resolvePromise) => res.on("finish", resolvePromise));
  await routes["GET /pinned-widget-media"](req, res, new URL(`http://localhost/pinned-widget-media?id=${created.body.widget.id}`));
  await finished;
  assert.equal(res.status, 206);
  assert.equal(res.headers["content-range"], "bytes 2-5/10");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.deepEqual(res.body(), Buffer.from("2345"));

  const denied = response();
  await routes["GET /pinned-widget-media"]({ headers: {} }, denied, new URL("http://localhost/pinned-widget-media?id=builtin:file-explorer"));
  assert.equal(denied.status, 415);
});

test("AVI artifacts open in the native player through a browser-compatible MP4 conversion", async (t) => {
  let converted = 0;
  const { root, routes } = fixture(t, {
    prepareVideo: async (_state, media) => {
      converted++;
      assert.equal(media.mimeType, "video/x-msvideo");
      return { ...media, mimeType: "video/mp4", displayName: "legacy.mp4" };
    },
  });
  const path = join(root, "legacy.avi");
  writeFileSync(path, Buffer.from("converted-video"));
  assert.deepEqual(classifyPinnedPath(path), { kind: "video", mimeType: "video/x-msvideo" });

  const created = response();
  await routes["POST /pinned-widgets"](request({ path, scope: "workspace" }), created);
  assert.equal(created.body.widget.kind, "video");

  const req = new PassThrough();
  req.headers = {};
  const res = streamResponse();
  const finished = new Promise((resolvePromise) => res.on("finish", resolvePromise));
  await routes["GET /pinned-widget-media"](req, res, new URL(`http://localhost/pinned-widget-media?id=${created.body.widget.id}`));
  await finished;
  assert.equal(converted, 1);
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "video/mp4");
  assert.match(res.headers["content-disposition"], /legacy.mp4/);
});
