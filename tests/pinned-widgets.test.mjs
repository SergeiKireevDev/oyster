import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { createRequestContext } from "../server/http/createRequestContext.mjs";
import { openAppStore } from "../server/persistence/appStore.mjs";
import {
  classifyPinnedPath,
  createPinnedWidgetRoutes,
  ensurePinnedHublot,
  formatMonitoringPreview,
  listPinnedWidgets,
  materializeMonitoringScripts,
  preparePinnedVideo,
  runMonitoringScript,
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
  const routes = createPinnedWidgetRoutes({ state, requestContext, ensureSessionOwner, listTunnels: () => [], monitorRoot: join(root, ".oyster", "monitoring-widgets"), ...routeOptions });
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

  const owner = appStore.repositories.sessions.upsert({
    backend: "sqlite", sessionId: "session-a", storagePath: "/tmp/agent.sqlite", createdAt: "created",
  });
  appStore.repositories.hublots.update(hublot.id, { owner_id: owner.id });
  const moved = ensurePinnedHublot(state, appStore.repositories.hublots.find(hublot.id));
  assert.equal(moved.scope, "session");
  assert.equal(moved.owner_id, owner.id);
  assert.equal(moved.position, 0);
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

test("an invalid widget label does not partially apply a requested move", async (t) => {
  const { root, routes, appStore } = fixture(t);
  const path = join(root, "atomic.md");
  writeFileSync(path, "# Atomic");
  const created = response();
  await routes["POST /pinned-widgets"](request({ path, scope: "workspace" }), created);
  const grouped = response();
  await routes["POST /pinned-widget-groups"](request({ name: "Destination", scope: "workspace" }), grouped);

  const patched = response();
  await routes["PATCH /pinned-widgets"](request({
    id: created.body.widget.id, groupId: grouped.body.group.id, label: "   ",
  }), patched);
  assert.equal(patched.status, 400);
  assert.equal(appStore.repositories.pinnedWidgets.find(created.body.widget.id).group_id, null);
});

test("widgets move between session-only and workspace-visible sections", async (t) => {
  const { root, routes } = fixture(t);
  writeFileSync(join(root, "shared.md"), "# Shared");

  const created = response();
  await routes["POST /pinned-widgets"](request({ path: join(root, "shared.md"), sessionId: "session-a" }), created);
  assert.equal(created.body.widget.scope, "session");
  assert.equal(created.body.widget.sessionId, "session-a");

  const madeDirectoryVisible = response();
  await routes["PATCH /pinned-widgets"](request({
    id: created.body.widget.id, scope: "workspace", groupId: null, sessionId: "session-a",
  }), madeDirectoryVisible);
  assert.equal(madeDirectoryVisible.status, 200);
  assert.equal(madeDirectoryVisible.body.widget.scope, "workspace");
  assert.equal(madeDirectoryVisible.body.widget.sessionId, null);

  const visibleToAnotherSession = response();
  routes["GET /pinned-widgets"]({}, visibleToAnotherSession, new URL("http://localhost/pinned-widgets?scope=session&sessionId=session-b"));
  assert.ok(visibleToAnotherSession.body.widgets.some((widget) => widget.id === created.body.widget.id));

  const madeSessionOnly = response();
  await routes["PATCH /pinned-widgets"](request({
    id: created.body.widget.id, scope: "session", groupId: null, sessionId: "session-b",
  }), madeSessionOnly);
  assert.equal(madeSessionOnly.body.widget.scope, "session");
  assert.equal(madeSessionOnly.body.widget.sessionId, "session-b");

  const hiddenFromOriginalSession = response();
  routes["GET /pinned-widgets"]({}, hiddenFromOriginalSession, new URL("http://localhost/pinned-widgets?scope=session&sessionId=session-a"));
  assert.ok(!hiddenFromOriginalSession.body.widgets.some((widget) => widget.id === created.body.widget.id));
});

test("groups and their widgets move together between visibility sections", async (t) => {
  const { root, routes } = fixture(t);
  writeFileSync(join(root, "grouped.md"), "# Grouped");

  const grouped = response();
  await routes["POST /pinned-widget-groups"](request({ name: "Animals", scope: "workspace" }), grouped);
  const created = response();
  await routes["POST /pinned-widgets"](request({
    path: join(root, "grouped.md"), scope: "workspace", groupId: grouped.body.group.id,
  }), created);

  const moved = response();
  await routes["PATCH /pinned-widget-groups"](request({
    id: grouped.body.group.id, scope: "session", sessionId: "session-a",
  }), moved);
  assert.equal(moved.status, 200);
  assert.equal(moved.body.group.scope, "session");
  assert.equal(moved.body.group.session_id, "session-a");

  const listed = response();
  routes["GET /pinned-widgets"]({}, listed, new URL("http://localhost/pinned-widgets?scope=session&sessionId=session-a"));
  const widget = listed.body.widgets.find((item) => item.id === created.body.widget.id);
  assert.equal(widget.scope, "session");
  assert.equal(widget.sessionId, "session-a");
  assert.equal(widget.groupId, grouped.body.group.id);
});

test("deleting a group with its widgets preserves the source artifacts", async (t) => {
  const { root, routes, appStore } = fixture(t);
  const paths = [join(root, "one.md"), join(root, "two.png")];
  writeFileSync(paths[0], "# One");
  writeFileSync(paths[1], Buffer.from([1, 2, 3]));

  const grouped = response();
  await routes["POST /pinned-widget-groups"](request({ name: "Disposable", sessionId: "session-a" }), grouped);
  const widgetIds = [];
  for (const path of paths) {
    const created = response();
    await routes["POST /pinned-widgets"](request({ path, groupId: grouped.body.group.id, sessionId: "session-a" }), created);
    widgetIds.push(created.body.widget.id);
  }

  const removed = response();
  routes["DELETE /pinned-widget-groups"]({}, removed, new URL(`http://localhost/pinned-widget-groups?id=${grouped.body.group.id}&deleteWidgets=1`));
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.deletedWidgets, widgetIds);
  assert.equal(appStore.repositories.pinnedWidgets.findGroup(grouped.body.group.id), null);
  assert.ok(widgetIds.every((id) => appStore.repositories.pinnedWidgets.find(id) === null));
  assert.ok(paths.every(existsSync));
});

test("monitoring previews are capped at twenty visible characters without splitting emoji", () => {
  assert.equal(formatMonitoringPreview("12345678901234567890"), "12345678901234567890");
  assert.equal(formatMonitoringPreview("123456789012345678901"), "1234567890123456789…");
  assert.equal([...formatMonitoringPreview("🟢".repeat(21))].length, 20);
  assert.equal(formatMonitoringPreview("a\r\nb"), "a\nb");
});

test("monitoring script materialization confines widget ids and rejects unknown execution modes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-monitor-materialization-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => materializeMonitoringScripts({
    id: "../escape",
    previewScript: "#!/bin/sh\ntrue",
    contentScript: "#!/bin/sh\ntrue",
    cwd: root,
    root,
  }), /invalid monitoring widget id/);
  assert.equal(readdirSync(root).length, 0);
  await assert.rejects(
    runMonitoringScript({ kind: "monitoring" }, "invalid", { resolveSafePath: (path) => path }),
    /monitoring mode must be preview or content/,
  );
});

test("failed monitoring widget creation removes newly materialized scripts", async (t) => {
  const { root, routes } = fixture(t);
  const monitorRoot = join(root, ".oyster", "monitoring-widgets");
  const base = {
    previewScript: "#!/bin/sh\ntrue",
    contentScript: "#!/bin/sh\ntrue",
    cwd: root,
    sessionId: "session-a",
  };
  for (const body of [{ ...base, label: "   " }, { ...base, format: "html" }]) {
    const created = response();
    await routes["POST /pinned-widgets"](request(body), created);
    assert.equal(created.status, 400);
    assert.deepEqual(readdirSync(monitorRoot), []);
  }
});

test("monitoring widgets persist scripts and execute preview and viewer content on demand", async (t) => {
  const { root, routes } = fixture(t);
  writeFileSync(join(root, "tracked.txt"), "ready\n");
  const created = response();
  await routes["POST /pinned-widgets"](request({
    label: "Repository state",
    previewScript: "#!/bin/sh\nprintf '●3 ±2 ?1'\n",
    contentScript: "#!/bin/sh\nprintf 'status: '; cat tracked.txt\n",
    cwd: root,
    format: "text",
    sessionId: "session-a",
  }), created);

  assert.equal(created.status, 201);
  assert.equal(created.body.widget.kind, "monitoring");
  assert.equal(created.body.widget.availability, "ready");
  assert.ok(created.body.widget.scriptDirectory.startsWith(join(root, ".oyster")));
  assert.equal(readFileSync(join(created.body.widget.scriptDirectory, "preview.sh"), "utf8"), "#!/bin/sh\nprintf '●3 ±2 ?1'\n");

  const preview = response();
  await routes["GET /pinned-widget-monitor-preview"]({}, preview, new URL(`http://localhost/pinned-widget-monitor-preview?id=${created.body.widget.id}`));
  assert.equal(preview.body.preview, "●3 ±2 ?1");

  const content = response();
  await routes["GET /pinned-widget-monitor-content"]({}, content, new URL(`http://localhost/pinned-widget-monitor-content?id=${created.body.widget.id}`));
  assert.equal(content.body.content, "status: ready");
  assert.equal(content.body.format, "text");
});

test("mutation routes reject JSON values that are not objects", async (t) => {
  const { routes } = fixture(t);
  for (const route of ["POST /pinned-widgets", "PATCH /pinned-widgets", "POST /pinned-widget-groups", "PATCH /pinned-widget-groups"]) {
    const res = response();
    await routes[route](request(null), res);
    assert.equal(res.status, 400, route);
    assert.match(res.body.error, /JSON object/, route);
  }
});

test("built-in widgets cannot be moved into session ownership or indirectly deleted with a group", async (t) => {
  const { routes, appStore } = fixture(t);

  const moved = response();
  await routes["PATCH /pinned-widgets"](request({
    id: "builtin:file-explorer", scope: "session", sessionId: "session-a",
  }), moved);
  assert.equal(moved.status, 409);
  assert.equal(appStore.repositories.pinnedWidgets.find("builtin:file-explorer").scope, "workspace");

  const grouped = response();
  await routes["POST /pinned-widget-groups"](request({ name: "Tools", scope: "workspace" }), grouped);
  const placed = response();
  await routes["PATCH /pinned-widgets"](request({
    id: "builtin:file-explorer", groupId: grouped.body.group.id,
  }), placed);
  assert.equal(placed.status, 200);

  const removed = response();
  routes["DELETE /pinned-widget-groups"]({}, removed, new URL(
    `http://localhost/pinned-widget-groups?id=${grouped.body.group.id}&deleteWidgets=1`,
  ));
  assert.equal(removed.status, 409);
  assert.ok(appStore.repositories.pinnedWidgets.find("builtin:file-explorer"));
  assert.ok(appStore.repositories.pinnedWidgets.findGroup(grouped.body.group.id));
});

test("widget creation rejects malformed scopes and credential-bearing links", async (t) => {
  const { root, routes } = fixture(t);
  const path = join(root, "notes.md");
  writeFileSync(path, "# Notes");

  const missingSession = response();
  await routes["POST /pinned-widgets"](request({ path, scope: "session" }), missingSession);
  assert.equal(missingSession.status, 400);
  assert.match(missingSession.body.error, /sessionId is required/);

  const invalidScope = response();
  await routes["POST /pinned-widgets"](request({ path, scope: "global" }), invalidScope);
  assert.equal(invalidScope.status, 400);

  const credentialLink = response();
  await routes["POST /pinned-widgets"](request({ url: "https://user:secret@example.com/report" }), credentialLink);
  assert.equal(credentialLink.status, 400);
  assert.match(credentialLink.body.error, /cannot contain credentials/);
});

test("standalone HTML of any size is streamed as a sandboxed pinned preview artifact", async (t) => {
  const { root, routes } = fixture(t);
  const path = join(root, "report.html");
  const html = `<!doctype html><html><head><style>body{color:navy}</style></head><body><h1>Report</h1><!--${"x".repeat(6 * 1024 * 1024)}--></body></html>`;
  writeFileSync(path, html);
  assert.deepEqual(classifyPinnedPath(path), { kind: "file", mimeType: "text/html; charset=utf-8" });

  const created = response();
  await routes["POST /pinned-widgets"](request({ path, sessionId: "session-a" }), created);
  assert.equal(created.body.widget.mimeType, "text/html; charset=utf-8");

  const req = new PassThrough();
  req.headers = {};
  const preview = streamResponse();
  const finished = new Promise((resolvePromise) => preview.on("finish", resolvePromise));
  routes["GET /pinned-widget-html"](req, preview, new URL(`http://localhost/pinned-widget-html?id=${created.body.widget.id}`));
  await finished;
  assert.equal(preview.status, 200);
  assert.equal(preview.headers["content-length"], Buffer.byteLength(html));
  assert.match(preview.headers["content-security-policy"], /sandbox; default-src 'none'/);
  assert.equal(preview.headers["x-content-type-options"], "nosniff");
  assert.equal(preview.body().toString(), html);

  const content = response();
  routes["GET /pinned-widget-content"]({}, content, new URL(`http://localhost/pinned-widget-content?id=${created.body.widget.id}`));
  assert.equal(content.status, 415);
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

test("SVG artifacts stream only through the sandboxed native image viewer", async (t) => {
  const { root, routes } = fixture(t);
  const path = join(root, "vector.svg");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>');
  writeFileSync(path, svg);
  assert.deepEqual(classifyPinnedPath(path), { kind: "image", mimeType: "image/svg+xml" });

  const created = response();
  await routes["POST /pinned-widgets"](request({ path, scope: "workspace" }), created);
  assert.equal(created.body.widget.kind, "image");
  assert.equal(created.body.widget.mimeType, "image/svg+xml");

  const req = new PassThrough();
  req.headers = {};
  const res = streamResponse();
  const finished = new Promise((resolvePromise) => res.on("finish", resolvePromise));
  await routes["GET /pinned-widget-media"](req, res, new URL(`http://localhost/pinned-widget-media?id=${created.body.widget.id}`));
  await finished;
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "image/svg+xml");
  assert.match(res.headers["content-security-policy"], /default-src 'none'; sandbox/);
  assert.match(res.headers["content-security-policy"], /style-src 'unsafe-inline'/);
  assert.deepEqual(res.body(), svg);
});

test("concurrent video preparation initializes and shares the transcode registry", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-video-transcode-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "legacy.avi");
  const cacheRoot = join(root, "cache");
  writeFileSync(source, "legacy video");
  const stat = statSync(source);
  const media = {
    row: { kind: "video" }, source, target: source, stat,
    mimeType: "video/x-msvideo", displayName: "legacy.avi",
  };
  const state = {};
  let conversions = 0;
  let release;
  const blocked = new Promise((resolvePromise) => { release = resolvePromise; });
  const execFileImpl = async (_bin, args) => {
    conversions++;
    await blocked;
    writeFileSync(args.at(-1), "converted video");
    return { stdout: "", stderr: "" };
  };

  const first = preparePinnedVideo(state, media, { cacheRoot, execFileImpl });
  const second = preparePinnedVideo(state, media, { cacheRoot, execFileImpl });
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(conversions, 1);
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.target, secondResult.target);
  assert.equal(firstResult.mimeType, "video/mp4");
  assert.equal(state.pinnedWidgetTranscodes.size, 0);
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
