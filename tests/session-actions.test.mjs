import test from "node:test";
import assert from "node:assert/strict";
import { fetchSessionPreview, markRunnerStopped, openSession, persistRunner, readPersistedRunner, sessionFileQuery, stopSessionRunner, switchSessionRunner, transcriptGateRequired, usageInfo } from "../public/src/lib/sessionActions.js";

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
test("session actions fetch durable transcript previews", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({ messages: [{ role: "user", content: "saved" }] }) };
  };
  assert.deepEqual(await fetchSessionPreview(fetchImpl, "/home/me/.pi/agent/sessions/--workspace--/a.jsonl"), [{ role: "user", content: "saved" }]);
  assert.equal(requests[0], "/session-messages?path=--workspace--%2Fa.jsonl");
  assert.equal(await fetchSessionPreview(async () => ({ ok: false }), "/other.jsonl"), null);
});

test("session actions open a runner with normalized server errors", async () => {
  const calls = [];
  const runner = await openSession(async (url, options) => {
    calls.push([url, options]);
    return { ok: true, json: async () => ({ runner: { id: "r2" } }) };
  }, { sessionPath: "/a.jsonl", dir: "/work" });
  assert.deepEqual(runner, { id: "r2" });
  assert.deepEqual(JSON.parse(calls[0][1].body), { sessionPath: "/a.jsonl", dir: "/work" });
  await assert.rejects(() => openSession(async () => ({ ok: false, status: 409, json: async () => ({ error: "busy" }) })), /busy/);
});

test("session actions stop runners with normalized errors", async () => {
  let request;
  await stopSessionRunner(async (url, options) => {
    request = [url, options];
    return { ok: true, json: async () => ({ stopped: true }) };
  }, "runner/a");
  assert.deepEqual(request, ["/runners?id=runner%2Fa", { method: "DELETE" }]);
  await assert.rejects(() => stopSessionRunner(async () => ({ ok: false, status: 404, json: async () => ({ error: "missing" }) }), "r"), /missing/);
});

test("session actions mark only the stopped runner inactive", () => {
  assert.deepEqual(markRunnerStopped([{ id: "a", alive: true, busy: true }, { id: "b", alive: true, busy: true }], "a"), [{ id: "a", alive: false, busy: false }, { id: "b", alive: true, busy: true }]);
});

test("session actions format usage information", () => {
  assert.equal(usageInfo({ input: 1200, output: 34, cost: { total: 0.0042 } }), "↑1,200 ↓34 tok · $0.0042");
  assert.equal(usageInfo(null), null);
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
