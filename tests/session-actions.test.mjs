import test from "node:test";
import assert from "node:assert/strict";
import { adjacentActiveRunner, createStateRefresher, formatSessionDate, fetchSessionPreview, markRunnerStopped, openSession, parseSessionRoute, persistRunner, readPersistedRunner, sessionFileQuery, stopSessionRunner, switchSessionRunner, syncSessionUrl, transcriptGateRequired, usageInfo } from "../public/src/lib/sessionActions.js";

test("session actions format session dates", () => {
  const now = new Date("2025-01-02T12:00:00Z");
  assert.equal(formatSessionDate(null, now), "");
  assert.ok(formatSessionDate("2025-01-02T10:30:00Z", now).length > 0);
});

test("session actions parse and synchronize session routes", () => {
  assert.deepEqual(parseSessionRoute("/s/session-1/m/message-2"), { sessionId: "session-1", messageId: "message-2" });
  const calls = [];
  syncSessionUrl({ location: { pathname: "/" }, history: { replaceState: (...args) => calls.push(args) }, sessionId: "session 1" });
  assert.deepEqual(calls, [[null, "", "/s/session%201"]]);
});

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

test("session actions select adjacent active runners in the current workdir", () => {
  const runners = [
    { id: "one", alive: true, sessionId: "s1", sessionName: "one", dir: "/work" },
    { id: "skip", alive: true, sessionId: null, sessionName: null, dir: "/work" },
    { id: "two", alive: true, sessionId: "s2", sessionName: "two", dir: "/work" },
  ];
  const result = adjacentActiveRunner(runners, "one", "/work", 1);
  assert.equal(result.target.id, "two");
  assert.equal(adjacentActiveRunner(runners, "one", "/other", 1).target, null);
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

test("session actions debounce state refreshes", async () => {
  let callback; let cleared = 0; let calls = 0;
  const refresh = createStateRefresher({ rpc: async () => ({ id: "state" }), applyState: () => calls++, setTimeoutImpl: (fn) => { callback = fn; return 1; }, clearTimeoutImpl: () => cleared++ });
  refresh(); refresh();
  assert.equal(cleared, 1);
  await callback();
  assert.equal(calls, 1);
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
