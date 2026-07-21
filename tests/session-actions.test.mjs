import test from "node:test";
import assert from "node:assert/strict";
import { adjacentActiveRunner, createAdjacentRunnerController, createCurrentRunnerController, createRunnerListController, createSearchHitSessionController, createSessionOpenController, createSessionPreviewController, createSessionUiController, createStateRefresher, formatSessionDate, fetchSessionEntries, fetchSessionPreview, groupSessionSearchResults, markRunnerStopped, openSession, parseSessionRoute, persistRunner, readPersistedRunner, sessionFileQuery, stopSessionRunner, switchSessionRunner, syncSessionUrl, transcriptGateRequired, usageInfo } from "../public/src/lib/sessionActions.js";

test("session actions group search hits by canonical session identity", () => {
  const grouped = groupSessionSearchResults([
    { sessionKey: "ps1_a", sessionPath: "/shared.sqlite", id: 1 },
    { sessionKey: "ps1_a", sessionPath: "/shared.sqlite", id: 2 },
    { sessionKey: "ps1_b", sessionPath: "/shared.sqlite", id: 3 },
  ]);
  assert.deepEqual(grouped.map((group) => [group.sessionKey, group.hits.length, group.first.id]), [["ps1_a", 2, 1], ["ps1_b", 1, 3]]);
});

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

test("session actions use opaque keys with session-root-relative file compatibility", () => {
  assert.equal(sessionFileQuery("/home/me/.pi/agent/sessions/--workspace--/a.jsonl"), "path=--workspace--%2Fa.jsonl");
  assert.equal(sessionFileQuery("ps1_sqlite_session"), "key=ps1_sqlite_session");
});

test("current runner controller persists and publishes selection", () => {
  const values = new Map([["pi_runner", "saved"]]);
  const patches = [];
  const controller = createCurrentRunnerController({ storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }, updateAppSession: (patch) => patches.push(patch) });
  assert.equal(controller.currentRunner, "saved");
  controller.set("next");
  controller.set(null);
  assert.deepEqual(patches, [{ currentRunner: "next" }, { currentRunner: null }]);
  assert.equal(values.has("pi_runner"), false);
});

test("runner list controller publishes normalized runner lists", () => {
  const patches = [];
  const controller = createRunnerListController({ updateAppSession: (patch) => patches.push(patch) });
  assert.deepEqual(controller.set([{ id: "r1" }]), [{ id: "r1" }]);
  assert.deepEqual(controller.set(null), []);
  assert.deepEqual(patches, [{ runners: [{ id: "r1" }] }, { runners: [] }]);
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
test("adjacent runner controller switches only when another active runner exists", () => {
  const calls = [];
  const controller = createAdjacentRunnerController({
    getRunners: () => [{ id: "a", alive: true, sessionId: "s1", sessionName: "one", dir: "/work" }, { id: "b", alive: true, sessionId: "s2", sessionName: "two", dir: "/work" }],
    getCurrentRunner: () => "a", getWorkdir: () => "/work", switchRunner: (id) => calls.push(id), toast: (message) => calls.push(message),
  });
  assert.equal(controller(1), true);
  assert.deepEqual(calls, ["b"]);
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

test("session actions fetch persisted session entries", async () => {
  const entries = await fetchSessionEntries(async (url) => ({ ok: true, json: async () => ({ entries: [{ id: "entry" }] }) }), "/home/me/.pi/agent/sessions/--workspace--/a.jsonl");
  assert.deepEqual(entries, [{ id: "entry" }]);
  await assert.rejects(() => fetchSessionEntries(async () => ({ ok: false, status: 404, json: async () => ({ error: "missing" }) }), "/a"), /missing/);
});

test("session preview controller renders only the current non-empty preview", async () => {
  const pending = new Map();
  const rendered = [];
  const controller = createSessionPreviewController({
    fetchPreview: (path) => new Promise((resolve) => pending.set(path, resolve)),
    render: (messages) => rendered.push(messages),
    now: () => 10,
  });
  controller.begin("old");
  controller.begin("current");
  pending.get("old")([{ role: "user", content: "stale" }]);
  pending.get("current")([]);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(rendered, []);
  controller.clear();
});

test("session preview controller renders a current successful preview", async () => {
  const rendered = [];
  const controller = createSessionPreviewController({ fetchPreview: async () => [{ role: "user", content: "saved" }], render: (messages) => rendered.push(messages) });
  controller.begin("current");
  await Promise.resolve();
  assert.deepEqual(rendered, [[{ role: "user", content: "saved" }]]);
});

test("session actions open a runner with normalized server errors", async () => {
  const calls = [];
  const runner = await openSession(async (url, options) => {
    calls.push([url, options]);
    return { ok: true, json: async () => ({ runner: { id: "r2" } }) };
  }, { sessionPath: "/a.jsonl", dir: "/work" });
  assert.deepEqual(runner, { id: "r2" });
  assert.deepEqual(JSON.parse(calls[0][1].body), { sessionPath: "/a.jsonl", dir: "/work" });
  await openSession(async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { sessionKey: "ps1_sqlite", dir: null });
    return { ok: true, json: async () => ({ runner: { id: "sqlite" } }) };
  }, { sessionKey: "ps1_sqlite" });
  await assert.rejects(() => openSession(async () => ({ ok: false, status: 409, json: async () => ({ error: "busy" }) })), /busy/);
});

test("session open controller previews resumed sessions and marks new runners empty", async () => {
  const previews = [];
  const empty = [];
  const open = createSessionOpenController({
    open: async (options) => ({ id: options.sessionPath ? "resumed" : "new" }),
    getCurrentRunner: () => "current",
    getRunners: () => [{ id: "current", sessionFile: "/current.jsonl" }],
    preview: { begin: (path) => previews.push(path) },
    markEmpty: (id) => empty.push(id),
  });
  await open({ sessionPath: "/other.jsonl" });
  await open({});
  assert.deepEqual(previews, ["/other.jsonl"]);
  assert.deepEqual(empty, ["new"]);
});

test("search hit controller reloads a runner already selected before focusing", async () => {
  const calls = [];
  const open = createSearchHitSessionController({
    close: () => calls.push("close"), getSessionId: () => "other", open: async () => ({ id: "current" }), getCurrentRunner: () => "current",
    setWorkdir: () => {}, reload: async () => calls.push("reload"), focus: () => calls.push("focus"), setAfterTranscript: () => {}, switchRunner: () => {}, toast: () => {},
  });
  await open("/session", { sessionId: "target" });
  assert.deepEqual(calls, ["close", "reload", "focus"]);
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

test("session UI controller synchronizes workdir, busy state, and usage", () => {
  const appPatches = [];
  const headerPatches = [];
  const controller = createSessionUiController({ updateAppSession: (patch) => appPatches.push(patch), updateHeaderState: (patch) => headerPatches.push(patch) });
  controller.setWorkdir("/workspace");
  controller.setBusy(true);
  controller.updateUsage({ usage: { input: 1200, output: 34, cost: { total: 0.0042 } } });
  assert.equal(controller.workdir, "/workspace");
  assert.equal(controller.busy, true);
  assert.deepEqual(appPatches, [{ workdir: "/workspace" }, { busy: true }]);
  assert.deepEqual(headerPatches, [{ usageInfo: "↑1,200 ↓34 tok · $0.0042" }]);
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
