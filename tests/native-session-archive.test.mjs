import test from "node:test";
import assert from "node:assert/strict";
import { createSessionRoutes } from "../server/http/routes/sessionRoutes.mjs";

test("native sessions archive independently of Pi and retain archive state in listings", async () => {
  const owners = new Map();
  const runners = new Map();
  const identity = (r) => `${r.backend}:${r.sessionId ?? r.id}`;
  const references = {
    serialize: (r) => identity(r),
    parse: (key) => { const [backend, id] = key.split(":"); return { backend, id, storagePath: null }; },
    validate: (r) => r,
    equals: (a, b) => identity(a) === identity(b),
  };
  for (const backend of ["codex", "gemini", "amp", "claude-code"]) {
    const ref = { backend, id: "same-id", storagePath: null };
    runners.set(backend, { id: backend, harness: backend, dir: "/work", sessionRef: ref, sessionName: backend, proc: {} });
    owners.set(identity(ref), { id: identity(ref), archived: false });
  }
  owners.set("sqlite:same-id", { id: "sqlite:same-id", archived: false });
  const repository = {
    find: (r) => owners.get(identity(r)),
    upsert: (r) => owners.get(identity(r)),
    setArchived: (id, archived) => { owners.get(id).archived = archived; },
  };
  const routes = createSessionRoutes({
    state: { currentDir: "/work", runners, sessionReferences: references, appStore: { repositories: { sessions: repository } } },
    requestContext: { json: (res, status, body) => Object.assign(res, { status, body }), readJsonBody: async (req) => req.body },
    sessions: { catalog: { backend: "sqlite", storagePath: "/pi.sqlite", list: () => [], family: () => assert.fail("must not inspect Pi families") } },
    runners: { stopRunner: (runner) => { runner.proc = null; }, runnersChanged() {} },
    resources: { closeTunnel() {} }, resolvePath: (p) => p,
  });
  for (const backend of ["codex", "gemini", "amp", "claude-code"]) {
    const key = `${backend}:same-id`;
    for (const archived of [true, false]) {
      const response = {};
      await routes["POST /session/archive"]({ body: { sessionKey: key, archived } }, response);
      assert.equal(response.status, 200);
      assert.equal(owners.get(key).archived, archived);
      assert.equal(runners.get(backend).proc, null);
      assert.equal(owners.get("sqlite:same-id").archived, false);
      const listed = {};
      await routes["GET /sessions"]({}, listed, new URL("http://localhost/sessions?dir=/work"));
      assert.equal(listed.status, 200);
      assert.equal(listed.body.sessions.find((s) => s.sessionKey === key).archived, archived);
    }
  }
  const missing = {};
  await routes["POST /session/archive"]({ body: { sessionKey: "codex:unregistered" } }, missing);
  assert.equal(missing.status, 404);
});
