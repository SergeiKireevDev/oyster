import test from "node:test";
import assert from "node:assert/strict";
import { createSessionBootController } from "../public/src/runtime/sessionBootController.js";
import {
  parentSessionIdentity,
  runnerSessionIdentity,
  sameSession,
  sessionIdentity,
  sessionIdentityQuery,
  sessionOpenSelection,
} from "../public/src/lib/sessionIdentity.js";

const key = "ps1_eyJiIjoic3FsaXRlIn0";

test("browser session identity prefers opaque keys with JSONL compatibility", () => {
  assert.equal(sessionIdentity({ sessionKey: key, path: "/legacy.jsonl" }), key);
  assert.equal(sessionIdentity({ path: "/legacy.jsonl" }), "/legacy.jsonl");
  assert.equal(runnerSessionIdentity({ sessionKey: key, sessionFile: null }), key);
  assert.equal(runnerSessionIdentity({ sessionFile: "/legacy.jsonl" }), "/legacy.jsonl");
  assert.equal(sameSession({ sessionKey: key }, key), true);
  assert.equal(sameSession({ path: "/a.jsonl" }, { path: "/b.jsonl" }), false);
});

test("browser session identity emits backend-neutral open and query payloads", () => {
  assert.deepEqual(sessionOpenSelection(key), { sessionKey: key });
  assert.deepEqual(sessionOpenSelection("/sessions/a.jsonl"), { sessionPath: "/sessions/a.jsonl" });
  assert.equal(sessionIdentityQuery(key), `key=${encodeURIComponent(key)}`);
  assert.equal(
    sessionIdentityQuery("/home/me/.pi/agent/sessions/--work--/a.jsonl"),
    "path=--work--%2Fa.jsonl",
  );
});

test("permalink boot opens an opaque-key session before connecting", async () => {
  const calls = [];
  const boot = createSessionBootController({
    route: { sessionId: "sqlite", messageId: "entry" },
    lookupSession: async () => ({ sessionKey: key, path: "/agent/sessions.sqlite", cwd: "/work" }),
    openInitialSession: async (options) => { calls.push(["open", options]); return { id: "runner" }; },
    setAfterTranscript: (callback) => { calls.push(["defer"]); callback(); },
    focusEntry: (id) => calls.push(["focus", id]),
    connect: () => calls.push(["connect"]),
  });
  await boot();
  assert.deepEqual(calls, [
    ["open", { sessionKey: key, dir: "/work" }],
    ["defer"], ["focus", "entry"], ["connect"],
  ]);
});

test("fork family identity supports key and path lineage", () => {
  assert.equal(parentSessionIdentity({ parentSessionKey: key, parentSession: "/old.jsonl" }), key);
  assert.equal(parentSessionIdentity({ parentSession: "/old.jsonl" }), "/old.jsonl");
});
