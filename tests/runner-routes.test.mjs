import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRunnerRoutes } from "../http/routes/runnerRoutes.mjs";

function response() {
  return {
    chunks: [],
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    write(chunk) { this.chunks.push(chunk); return true; },
  };
}

function setup() {
  const runner = { id: "runner-1", dir: "/workspace", proc: null, buffer: ['{"type":"old"}'] };
  const state = {
    sseClients: new Set(),
    runners: new Map([[runner.id, runner]]),
    currentDir: "/workspace",
    broadcast(line) {
      for (const client of this.sseClients) client.write(`data: ${line}\n\n`);
    },
  };
  const intervals = [];
  const cleared = [];
  const dependencies = {
    state,
    runnerFromReq: () => runner,
    startRunner: (selected) => { selected.proc = { pid: 42 }; },
    listRunnerInfo: () => [{ id: runner.id, alive: !!runner.proc }],
    setIntervalImpl: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; },
    clearIntervalImpl: (id) => cleared.push(id),
    requestContext: {
      json(res, status, value) { res.status = status; res.body = value; },
      readJsonBody: async (req) => req.body,
      resolveSafePath: (path) => path.startsWith("/allowed") ? path : null,
    },
    sendToRunner: (_selected, command) => command.type !== "unavailable",
    stopRunner: (selected) => { selected.stopped = true; },
    runnerInfo: (selected) => ({ id: selected.id, dir: selected.dir }),
    openSessionRunner: ({ sessionPath, dir }) => ({ id: "opened", sessionPath, dir }),
    sessionFileParam: (path) => path === "valid.jsonl" ? "/sessions/valid.jsonl" : null,
    autoTitleFork: (selected, command) => { selected.titledWith = command; },
    setTimeoutImpl: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; },
    resolvePath: (path) => path,
    isDirectory: (path) => path !== "/allowed/file",
  };
  return { runner, state, intervals, cleared, dependencies };
}

test("events route registers before replay, replays runner output, pings, and cleans up", () => {
  const { state, intervals, cleared, dependencies } = setup();
  const handler = createRunnerRoutes(dependencies)["GET /events"];
  const req = new EventEmitter();
  const res = response();
  handler(req, res, new URL("http://localhost/events?runner=runner-1"));

  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "text/event-stream");
  assert.equal(res.runnerId, "runner-1");
  assert.equal(state.sseClients.has(res), true);
  assert.ok(res.chunks.some((chunk) => chunk.includes('{"type":"old"}')));
  assert.ok(res.chunks.some((chunk) => chunk.includes('"type":"replay_done"')));
  assert.equal(intervals[0].delay, 25000);
  intervals[0].callback();
  assert.ok(res.chunks.at(-1).includes('"type":"ping"'));

  req.emit("close");
  assert.equal(state.sseClients.has(res), false);
  assert.deepEqual(cleared, [1]);
});

test("SSE reconnect can skip replay while still receiving replay completion", () => {
  const { dependencies } = setup();
  const handler = createRunnerRoutes(dependencies)["GET /events"];
  const res = response();
  handler(new EventEmitter(), res, new URL("http://localhost/events?replay=0"));
  assert.equal(res.chunks.some((chunk) => chunk.includes('{"type":"old"}')), false);
  assert.ok(res.chunks.some((chunk) => chunk.includes('"type":"replay_done"')));
});

test("runner RPC routes preserve validation, queue status, and listing contracts", async () => {
  const { runner, dependencies } = setup();
  const routes = createRunnerRoutes(dependencies);

  const invalid = response();
  await routes["POST /rpc"]({ body: {} }, invalid, new URL("http://localhost/rpc"));
  assert.equal(invalid.status, 400);

  const queued = response();
  await routes["POST /rpc"]({ body: { type: "prompt", message: "hello" } }, queued, new URL("http://localhost/rpc"));
  assert.equal(queued.status, 202);
  assert.deepEqual(queued.body, { queued: true, runner: "runner-1" });
  assert.equal(runner.titledWith.message, "hello");

  const unavailable = response();
  await routes["POST /rpc"]({ body: { type: "unavailable" } }, unavailable, new URL("http://localhost/rpc"));
  assert.equal(unavailable.status, 503);

  const listed = response();
  routes["GET /runners"]({}, listed);
  assert.deepEqual(listed.body, { runners: [{ id: "runner-1", alive: false }] });
});

test("runner stop and restart routes preserve selection, status, and delayed restart", () => {
  const { runner, state, intervals, dependencies } = setup();
  const routes = createRunnerRoutes(dependencies);

  const missing = response();
  routes["DELETE /runners"]({}, missing, new URL("http://localhost/runners?id=missing"));
  assert.equal(missing.status, 404);

  const stopped = response();
  routes["DELETE /runners"]({}, stopped, new URL("http://localhost/runners?id=runner-1"));
  assert.equal(stopped.status, 200);
  assert.equal(runner.stopped, true);

  runner.stopped = false;
  const restarted = response();
  routes["POST /restart"]({}, restarted, new URL("http://localhost/restart"));
  assert.equal(restarted.status, 202);
  assert.equal(intervals[0].delay, 300);
  intervals[0].callback();
  assert.deepEqual(runner.proc, { pid: 42 });
  assert.equal(state.runners.has(runner.id), true);
});

test("open-session validates session and directory inputs before opening a runner", async () => {
  const { state, dependencies } = setup();
  const route = createRunnerRoutes(dependencies)["POST /open-session"];

  const badSession = response();
  await route({ body: { sessionPath: "missing.jsonl" } }, badSession);
  assert.equal(badSession.status, 400);

  const forbidden = response();
  await route({ body: { dir: "/outside" } }, forbidden);
  assert.equal(forbidden.status, 403);

  const notDirectory = response();
  await route({ body: { dir: "/allowed/file" } }, notDirectory);
  assert.equal(notDirectory.status, 400);

  const opened = response();
  await route({ body: { sessionPath: "valid.jsonl", dir: "/allowed/project" } }, opened);
  assert.equal(opened.status, 200);
  assert.equal(state.currentDir, "/allowed/project");
  assert.deepEqual(opened.body.runner, { id: "opened", dir: "/allowed/project" });
});

test("constructing reloaded runner routes leaves old SSE responses state-owned and writable", () => {
  const { state, dependencies } = setup();
  const oldHandler = createRunnerRoutes(dependencies)["GET /events"];
  const res = response();
  oldHandler(new EventEmitter(), res, new URL("http://localhost/events"));

  createRunnerRoutes(dependencies);
  state.broadcast('{"type":"after_reload"}');

  assert.equal(state.sseClients.has(res), true);
  assert.ok(res.chunks.at(-1).includes('"type":"after_reload"'));
});
