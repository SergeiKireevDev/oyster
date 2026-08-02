import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequestContext } from "../server/http/createRequestContext.mjs";

function state(overrides = {}) {
  return {
    config: {
      TOKEN: "secret-token",
      PI_DIR: tmpdir(),
      DIRNAME: tmpdir(),
      ...overrides,
    },
  };
}

function responseRecorder() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
}

function request(body, options = {}) {
  const req = Readable.from([Buffer.from(body)]);
  req.method = options.method ?? "GET";
  req.headers = options.headers ?? {};
  req.socket = { remoteAddress: options.ip ?? "127.0.0.1" };
  return req;
}

test("response helpers preserve JSON and text status, body, and content headers", () => {
  const context = createRequestContext(state());
  const jsonResponse = responseRecorder();
  context.json(jsonResponse, 201, { ok: true });
  assert.equal(jsonResponse.status, 201);
  assert.equal(jsonResponse.headers["content-type"], "application/json");
  assert.equal(jsonResponse.headers["content-length"], Buffer.byteLength('{"ok":true}'));
  assert.equal(jsonResponse.body, '{"ok":true}');

  const textResponse = responseRecorder();
  context.text(textResponse, 404, "not here");
  assert.equal(textResponse.status, 404);
  assert.equal(textResponse.headers["content-type"], "text/plain; charset=utf-8");
  assert.equal(textResponse.body, "not here");
});

test("body helpers parse JSON, preserve binary input, and report malformed JSON as 400", async () => {
  const context = createRequestContext(state());
  assert.deepEqual(await context.readJsonBody(request('{"value":3}'), responseRecorder()), { value: 3 });
  assert.deepEqual(await context.readRawBody(request("\u0000data")), Buffer.from("\u0000data"));

  const invalidResponse = responseRecorder();
  assert.equal(await context.readJsonBody(request("{"), invalidResponse), undefined);
  assert.equal(invalidResponse.status, 400);
  assert.match(JSON.parse(invalidResponse.body).error, /^invalid JSON:/);

  await assert.rejects(context.readBody(request("12345"), 4), /body too large/);
  await assert.rejects(context.readBody(request(""), -1), /body limit must be a non-negative safe integer/);
});

test("body helpers enforce byte limits, handle aborted requests, and return 413 for oversized JSON", async () => {
  const context = createRequestContext(state());
  const encoded = request("é");
  encoded.setEncoding("utf8");
  await assert.rejects(context.readBody(encoded, 1), (error) => error.code === "body_too_large");

  const aborted = new Readable({ read() {} });
  const abortedBody = context.readBody(aborted);
  aborted.emit("aborted");
  aborted.emit("error", new Error("connection reset"));
  await assert.rejects(abortedBody, (error) => error.code === "request_aborted");

  const oversizedResponse = responseRecorder();
  const oversized = request(`"${"x".repeat(5 * 1024 * 1024)}"`);
  assert.equal(await context.readJsonBody(oversized, oversizedResponse), undefined);
  assert.equal(oversizedResponse.status, 413);
  assert.deepEqual(JSON.parse(oversizedResponse.body), { error: "request body too large" });
});

test("MIME lookup handles known extensions case-insensitively and defaults binary", () => {
  const { mimeType } = createRequestContext(state());
  assert.equal(mimeType("bundle.JS"), "text/javascript; charset=utf-8");
  assert.equal(mimeType("app.webmanifest"), "application/manifest+json; charset=utf-8");
  assert.equal(mimeType("photo.jpeg"), "image/jpeg");
  assert.equal(mimeType("archive.unknown"), "application/octet-stream");
});

test("token comparison and auth accept supported credentials while query auth stays GET-only", () => {
  const context = createRequestContext(state(), { logger: { log() {} } });
  assert.equal(context.tokenMatches(" secret-token "), true);
  assert.equal(context.tokenMatches("wrong-token"), false);

  const get = request("", { method: "GET" });
  assert.equal(context.checkAuth(get, new URL("http://localhost/path?token=secret-token")), "ok");

  const postQuery = request("", { method: "POST", ip: "127.0.0.2" });
  assert.equal(context.checkAuth(postQuery, new URL("http://localhost/path?token=secret-token")), "fail");
  const postBearer = request("", { method: "POST", ip: "127.0.0.2", headers: { authorization: "Bearer secret-token" } });
  assert.equal(context.checkAuth(postBearer, new URL("http://localhost/path")), "ok");
  const eventSourceCookie = request("", { method: "GET", ip: "127.0.0.3", headers: { cookie: "bad=%E0%A4%A; oyster_token=secret-token" } });
  assert.equal(context.checkAuth(eventSourceCookie, new URL("http://localhost/events")), "ok");
});

test("auth failure logs do not expose credential prefixes or permit control-character injection", () => {
  let message = "";
  const context = createRequestContext(state(), { logger: { log(value) { message = value; } } });
  const req = request("", {
    method: "GET",
    headers: { authorization: "canary-credential", "user-agent": "agent\nforged" },
  });
  assert.equal(context.checkAuth(req, new URL("http://localhost/private")), "fail");
  assert.doesNotMatch(message, /canary/);
  assert.match(message, /bearer=present\(17\)/);
  assert.doesNotMatch(message, /[\r\n]/);
});

test("unauthenticated mode accepts requests without credentials or auth-failure state", () => {
  const stableState = state({ UNAUTHENTICATED: true });
  const context = createRequestContext(stableState, { logger: { log: () => assert.fail("must not log an auth failure") } });
  assert.equal(context.checkAuth(request("", { method: "POST", ip: "192.0.2.10" }), new URL("http://localhost/rpc")), "ok");
  assert.equal(stableState.authFails, undefined);
});

test("auth failures are state-owned, expire by window, and throttle at the existing limit", () => {
  let currentTime = 1_000;
  const stableState = state();
  const context = createRequestContext(stableState, { now: () => currentTime, logger: { log() {} } });
  const url = new URL("http://localhost/private");
  for (let attempt = 0; attempt < 20; attempt++) {
    assert.equal(context.checkAuth(request("", { ip: "192.0.2.1" }), url), "fail");
  }
  assert.equal(context.checkAuth(request("", { ip: "192.0.2.1" }), url), "throttled");
  assert.equal(stableState.authFails.get("192.0.2.1").length, 20);

  currentTime += 10 * 60 * 1000;
  assert.equal(context.checkAuth(request("", { ip: "192.0.2.1" }), url), "fail");
});

test("safe path resolution permits configured roots and rejects escapes and denied paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "request-context-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const allowed = join(root, "allowed.txt");
  const outsideLink = join(root, "outside-link");
  const tokenFile = join(root, ".ui-token");
  const dirnameAlias = join(root, "dirname-alias");
  await writeFile(allowed, "ok");
  await writeFile(tokenFile, "secret");
  await symlink("/etc/passwd", outsideLink);
  await symlink(root, dirnameAlias);

  const context = createRequestContext(state({ PI_DIR: root, DIRNAME: dirnameAlias }));
  assert.equal(context.resolveSafePath(allowed), allowed);
  assert.equal(context.resolveSafePath(join(root, "missing-parent", "new.txt")), join(root, "missing-parent", "new.txt"));
  assert.equal(context.resolveSafePath(outsideLink), null);
  assert.equal(context.resolveSafePath(tokenFile), null);
});
