import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import {
  createUploadLimiter,
  prepareScopedWorkspaceRequest,
  proxyWorkspaceRequest,
  readBufferedRequestBody,
} from "../oyster-hub/workspace-proxy.mjs";

function request(chunks, { method = "POST", contentType = "application/octet-stream" } = {}) {
  const req = Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
  req.method = method;
  req.headers = {
    "content-type": contentType,
    "content-length": String(chunks.reduce((size, chunk) => size + Buffer.byteLength(chunk), 0)),
  };
  return req;
}

test("workspace JSON buffering enforces its configured bound", async () => {
  await assert.rejects(
    readBufferedRequestBody(request(["abc", "def"]), 5),
    (error) => error.code === "body_too_large" && /exceeds 5 bytes/.test(error.message),
  );
});

test("workspace preparation decodes scoped JSON but leaves opaque bodies streaming", async () => {
  const parse = (value) => value === "scope:alpha:runner-1"
    ? { workspaceId: "alpha", kind: "runner", value: "runner-1" }
    : null;
  const jsonReq = request([JSON.stringify({ runner: "scope:alpha:runner-1" })], { contentType: "application/json" });
  const preparedJson = await prepareScopedWorkspaceRequest(jsonReq, new URL("http://hub/rpc"), parse);
  assert.equal(preparedJson.streaming, false);
  assert.deepEqual(JSON.parse(preparedJson.body), { runner: "runner-1" });
  assert.deepEqual([...preparedJson.scopes], ["alpha"]);

  const opaqueReq = request(["first", "second"]);
  const preparedOpaque = await prepareScopedWorkspaceRequest(opaqueReq, new URL("http://hub/file-upload?workspace=alpha"), parse);
  assert.equal(preparedOpaque.streaming, true);
  assert.equal(preparedOpaque.body, opaqueReq);
  assert.equal(opaqueReq.readableEnded, false);
});

test("browser upload disconnects do not leave an unhandled monitored-body error", async () => {
  const req = new PassThrough();
  req.method = "POST";
  req.headers = { "content-type": "application/octet-stream", "transfer-encoding": "chunked" };
  req.on("error", () => {});
  const res = Object.assign(new EventEmitter(), { headersSent: false, writableEnded: false });
  let response;
  const operation = proxyWorkspaceRequest({
    req,
    res,
    target: "http://workspace/file-upload",
    workspace: { id: "alpha", token: null },
    timeoutMs: 1000,
    uploadIdleTimeoutMs: 1000,
    uploadResponseTimeoutMs: 1000,
    uploadLimiter: createUploadLimiter(1),
    json(_res, status, value) { response = { status, value }; },
    fetchImpl(_target, { signal }) {
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  req.emit("aborted");
  req.destroy(new Error("client socket closed"));
  await operation;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(response.status, 502);
  assert.equal(response.value.detail, "browser disconnected during workspace request");
});

test("browser response disconnects consume the matching aborted upstream stream error", async () => {
  const req = request([], { method: "GET" });
  const res = new PassThrough();
  res.headersSent = false;
  res.writeHead = () => { res.headersSent = true; };
  res.on("error", () => {});
  let upstreamController;
  const operation = proxyWorkspaceRequest({
    req,
    res,
    target: "http://workspace/events",
    workspace: { id: "alpha", token: null },
    timeoutMs: 1000,
    uploadIdleTimeoutMs: 1000,
    uploadResponseTimeoutMs: 1000,
    json() {},
    fetchImpl(_target, { signal }) {
      signal.addEventListener("abort", () => queueMicrotask(() => upstreamController.error(signal.reason)), { once: true });
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          upstreamController = controller;
          controller.enqueue(new TextEncoder().encode("data: connected\\n\\n"));
        },
      }), { headers: { "content-type": "text/event-stream" } }));
    },
  });
  await new Promise((resolve) => res.once("data", resolve));
  res.destroy();
  await operation;
  await new Promise((resolve) => setImmediate(resolve));
});

test("workspace upload limiter bounds and idempotently releases slots", () => {
  const limiter = createUploadLimiter(1);
  const release = limiter.tryAcquire();
  assert.equal(typeof release, "function");
  assert.equal(limiter.active, 1);
  assert.equal(limiter.tryAcquire(), null);
  release();
  release();
  assert.equal(limiter.active, 0);
  assert.equal(typeof limiter.tryAcquire(), "function");
});
