import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointTreeController } from "../public/src/lib/checkpointTreeController.js";

function controller(overrides = {}) {
  const states = [];
  const toasts = [];
  const options = {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ root: { id: "root" } }) }),
    getState: () => ({ sessionId: "current", sessionFile: "/sessions/current.jsonl" }),
    getRunners: () => [{ id: "runner", sessionFile: "/sessions/fallback.jsonl" }],
    getCurrentRunner: () => "runner",
    getWorkdir: () => "/work",
    setTreeState: (state) => states.push(state),
    isOpen: () => false,
    openSession: async () => ({ id: "opened" }),
    switchRunner: () => {},
    toast: (...args) => toasts.push(args),
    ...overrides,
  };
  return { controller: createCheckpointTreeController(options), states, toasts };
}

test("checkpoint tree controller loads the current session tree", async () => {
  const requests = [];
  const { controller: tree, states } = controller({ fetchImpl: async (url) => {
    requests.push(url);
    return { ok: true, status: 200, json: async () => ({ root: { id: "root" } }) };
  } });
  await tree.load();
  assert.equal(requests[0], "/checkpoint-tree?path=%2Fsessions%2Fcurrent.jsonl");
  assert.deepEqual(states.at(-1), { loading: false, root: { id: "root" }, empty: "", error: "" });
});

test("checkpoint tree controller treats an unwritten session as empty", async () => {
  const { controller: tree, states } = controller({ fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: "not a session file" }) }) });
  await tree.load();
  assert.deepEqual(states.at(-1), { loading: false, root: null, empty: "no session file yet — send a message first" });
});

test("checkpoint tree controller opens another tree session", async () => {
  const opened = [];
  const switched = [];
  const { controller: tree, toasts } = controller({
    openSession: async (options) => { opened.push(options); return { id: "next-runner" }; },
    switchRunner: (id) => switched.push(id),
  });
  await tree.openTreeSession({ id: "other", path: "/sessions/other.jsonl", cwd: "/other", name: "Other" });
  assert.deepEqual(opened, [{ sessionPath: "/sessions/other.jsonl", dir: "/other" }]);
  assert.deepEqual(switched, ["next-runner"]);
  assert.deepEqual(toasts, [["switched to: Other"]]);
});
