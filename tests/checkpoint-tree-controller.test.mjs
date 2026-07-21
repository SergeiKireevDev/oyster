import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointTreeController, createCheckpointTreeEventController } from "../public/src/lib/checkpointTreeController.js";

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
    openAndSwitchSession: async () => ({ id: "opened" }),
    toast: (...args) => toasts.push(args),
    ...overrides,
  };
  return { controller: createCheckpointTreeController(options), states, toasts };
}

test("checkpoint tree event controller routes typed details and tears down", () => {
  const listeners = new Map();
  const windowTarget = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); } };
  const calls = [];
  const controller = createCheckpointTreeEventController({ windowTarget, openSession: (session) => calls.push(["open", session]), rollback: (checkpoint, target) => calls.push(["rollback", checkpoint, target]) });
  controller.attach();
  listeners.get("pi-checkpoint-tree-open-session")({ detail: { id: "session" } });
  listeners.get("pi-checkpoint-tree-rollback")({ detail: { checkpoint: "abc", target: "message" } });
  controller.detach();
  assert.deepEqual(calls, [["open", { id: "session" }], ["rollback", "abc", "message"]]);
  assert.equal(listeners.size, 0);
});

test("checkpoint tree controller loads the current session tree", async () => {
  const requests = [];
  const { controller: tree, states } = controller({ fetchImpl: async (url) => {
    requests.push(url);
    return { ok: true, status: 200, json: async () => ({ root: { id: "root" } }) };
  } });
  await tree.load();
  assert.equal(requests[0], "/checkpoint-tree?path=sessions%2Fcurrent.jsonl");
  assert.deepEqual(states.at(-1), { loading: false, root: { id: "root" }, empty: "", error: "" });
});

test("checkpoint tree controller loads SQLite sessions by opaque runner key", async () => {
  const requests = [];
  const { controller: tree } = controller({
    getState: () => ({ sessionId: "sqlite", sessionFile: null }),
    getRunners: () => [{ id: "runner", sessionKey: "ps1_sqlite", sessionFile: null }],
    fetchImpl: async (url) => { requests.push(url); return { ok: true, status: 200, json: async () => ({ root: {} }) }; },
  });
  await tree.load();
  assert.equal(requests[0], "/checkpoint-tree?key=ps1_sqlite");
});

test("checkpoint tree controller treats an unwritten session as empty", async () => {
  const { controller: tree, states } = controller({ fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: "not a session file" }) }) });
  await tree.load();
  assert.deepEqual(states.at(-1), { loading: false, root: null, empty: "no session file yet — send a message first" });
});

test("checkpoint tree controller opens another tree session", async () => {
  const opened = [];
  const { controller: tree, toasts } = controller({
    openAndSwitchSession: async (options) => { opened.push(options); return { id: "next-runner" }; },
  });
  await tree.openTreeSession({ id: "other", path: "/sessions/other.jsonl", cwd: "/other", name: "Other" });
  assert.deepEqual(opened, [{ sessionPath: "/sessions/other.jsonl", dir: "/other" }]);
  assert.deepEqual(toasts, [["switched to: Other"]]);
});
