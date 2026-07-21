import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeAttachments } from "../public/src/runtime/runtimeAttachments.js";

test("runtime attachments install once and detach registered integrations", () => {
  const calls = [];
  const runtime = createRuntimeAttachments({
    installAuthenticatedFetch: () => { calls.push("auth install"); return { detach: () => calls.push("auth detach") }; },
    installDebugHooks: () => { calls.push("debug install"); return { detach: () => calls.push("debug detach") }; },
  });

  runtime.attachAuthenticatedFetch();
  runtime.attachAuthenticatedFetch();
  runtime.attachDebugHooks();
  runtime.attachDebugHooks();
  runtime.detach();

  assert.deepEqual(calls, ["auth install", "debug install", "debug detach", "auth detach"]);
});
