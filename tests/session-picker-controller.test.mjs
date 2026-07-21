import test from "node:test";
import assert from "node:assert/strict";
import { createSessionPickerController, createSessionPickerDeleteController, createSessionPickerFolderController } from "../public/src/lib/sessionPickerController.js";
test("session picker controller stops the runner owning a session", async () => {
  const runners = [{ id: "runner", sessionFile: "/session.jsonl", alive: true }]; let stopped; let next;
  const controller = createSessionPickerController({ stopRunner: async (id) => { stopped = id; }, getRunners: () => runners, markStopped: (items, id) => items.map((item) => ({ ...item, alive: item.id !== id })), setRunners: (items) => { next = items; }, toast: () => {} });
  await controller.stopSession({ path: "/session.jsonl" });
  assert.equal(stopped, "runner"); assert.equal(next[0].alive, false);
  assert.deepEqual(controller.chooseSession("/session.jsonl", [{ path: "/session.jsonl" }]), { path: "/session.jsonl" });
  assert.equal(controller.chooseSession("missing", []), null);
});

test("session picker delete controller updates sessions and refreshes released resources", async () => {
  let sessions = [{ path: "one" }, { path: "two" }]; let hublots = 0; let routines = 0; const messages = [];
  const controller = createSessionPickerDeleteController({
    removeSession: async () => ({ closedHublots: [3000], releasedRoutines: ["job.sh"] }),
    getSessions: () => sessions, setSessions: (next) => { sessions = next; }, toast: (...args) => messages.push(args),
    refreshHublots: () => hublots++, refreshRoutines: () => routines++, confirm: () => true,
  });
  await controller.deleteSession({ path: "one" });
  assert.deepEqual(sessions, [{ path: "two" }]);
  assert.equal(hublots, 1); assert.equal(routines, 1);
  assert.deepEqual(messages, [["session deleted · closed hublot :3000 · released routine job.sh"]]);
});

test("session picker folder controller loads a folder once and clears loading on errors", async () => {
  let snapshot = { otherFolderSessions: {}, loadingFolders: {} };
  const updates = []; const errors = [];
  const controller = createSessionPickerFolderController({
    fetchSessions: async (folder) => folder === "bad" ? Promise.reject(new Error("nope")) : [{ path: folder }],
    getSnapshot: () => snapshot,
    update: (next) => { snapshot = { ...snapshot, ...next }; updates.push(next); },
    getRunners: () => [{ id: "runner" }],
    setSessions: () => {},
    toast: (...args) => errors.push(args),
  });
  await controller.loadFolder({ dir: "good", label: "Good" });
  await controller.loadFolder({ dir: "good", label: "Good" });
  assert.deepEqual(snapshot.otherFolderSessions.good, [{ path: "good" }]);
  assert.equal(updates.length, 2);
  await controller.loadFolder({ dir: "bad", label: "Bad" });
  assert.equal(snapshot.loadingFolders.bad, false);
  assert.deepEqual(errors, [["failed to list Bad: nope", "error"]]);
});
