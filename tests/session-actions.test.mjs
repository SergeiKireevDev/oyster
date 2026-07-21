import test from "node:test";
import assert from "node:assert/strict";
import { persistRunner, readPersistedRunner, sessionFileQuery, switchSessionRunner, transcriptGateRequired } from "../public/src/lib/sessionActions.js";

test("session actions persist the current runner", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  persistRunner(storage, "runner-1");
  assert.equal(readPersistedRunner(storage), "runner-1");
  persistRunner(storage, null);
  assert.equal(readPersistedRunner(storage), null);
});

test("session actions use session-root-relative file queries", () => {
  assert.equal(sessionFileQuery("/home/me/.pi/agent/sessions/--workspace--/a.jsonl"), "path=--workspace--%2Fa.jsonl");
});
test("session actions skip transcript replay for empty runners", () => {
  const empty = new Set(["new"]);
  assert.equal(transcriptGateRequired({ runner: "new", messageCount: 1, emptySessionRunners: empty }), false);
  assert.equal(transcriptGateRequired({ runner: "old", messageCount: 1, emptySessionRunners: empty }), true);
});

test("session actions switch runners without SSE replay", () => {
  const calls = [];
  const hooks = Object.fromEntries(["log", "resetPreview", "refreshState", "setRunner", "clearTranscript", "resetSessionUi", "renderPreview", "resetCommands"].map((name) => [name, (...args) => calls.push([name, ...args]) ]));
  hooks.connect = (options) => calls.push(["connect", options]);
  assert.equal(switchSessionRunner({ id: "next", currentRunner: "current", hooks }), true);
  assert.deepEqual(calls.at(-1), ["connect", { replay: false }]);
});
