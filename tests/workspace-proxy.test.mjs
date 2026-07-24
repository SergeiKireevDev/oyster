import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  createUploadLimiter,
  prepareScopedWorkspaceRequest,
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
