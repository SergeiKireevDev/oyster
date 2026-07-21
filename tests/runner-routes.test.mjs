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
