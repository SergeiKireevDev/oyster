import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRunnerRoutes } from "../server/http/routes/runnerRoutes.mjs";

function response() {
  return Object.assign(new EventEmitter(), {
    chunks: [],
    writableEnded: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    write(chunk) { this.chunks.push(chunk); return true; },
    end() { this.writableEnded = true; },
  });
}

function setup() {
  const runner = { id: "runner-1", dir: "/workspace", proc: null };
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
    replayRunnerEvents: () => ['{"type":"old"}'],
    setIntervalImpl: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; },
    clearIntervalImpl: (id) => cleared.push(id),
    requestContext: {
      json(res, status, value) { res.status = status; res.body = value; },
      readJsonBody: async (req) => req.body,
      resolveSafePath: (path) => path.startsWith("/allowed") ? path : null,
    },
    sendToRunner: (_selected, command) => command.type !== "unavailable",
    stopRunner: (selected) => { selected.stopped = true; selected.proc = null; },
    spawnRunner: ({ dir, initialArgs }) => {
      const child = { id: "child-runner", dir, initialArgs, proc: { pid: 43 } };
      state.runners.set(child.id, child);
      return child;
    },
    observeRunner: (_selected, listener) => {
      dependencies.subagentListener = listener;
      return () => { dependencies.subagentListener = null; };
    },
    runnerInfo: (selected) => ({ id: selected.id, dir: selected.dir, ...(selected.sessionRef ? { sessionRef: selected.sessionRef } : {}) }),
    openSessionRunner: ({ sessionRef, dir }) => ({ id: "opened", sessionRef, dir }),
    sessionReferenceParam: ({ sessionKey, sessionPath }) => {
      if (sessionKey === "sqlite-key") return { backend: "sqlite", id: "sqlite-id", storagePath: "/agent/sessions.sqlite" };
      if (sessionPath === "valid.jsonl") return { backend: "jsonl", id: "jsonl-id", storagePath: "/sessions/valid.jsonl" };
      return null;
    },
    srvId: () => "srv-1",
    runnersChanged: () => {}, 
    setTimeoutImpl: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; },
    clearTimeoutImpl: () => {},
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
  assert.equal(dependencies.runnerFromReq().proc, null, "read-only SSE subscription must not start pi");
  assert.ok(res.chunks.some((chunk) => chunk.includes('{"type":"old"}')));
  assert.ok(res.chunks.some((chunk) => chunk.includes('"type":"replay_done"')));
  assert.equal(intervals[0].delay, 25000);
  intervals[0].callback();
  const ping = JSON.parse(res.chunks.at(-1).match(/^data: (.*)\n\n$/)[1]);
  assert.deepEqual(ping, { type: "ping", _server: true }, "heartbeats must not resend the runner catalog");

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
  const sends = [];
  const sendToRunner = dependencies.sendToRunner;
  dependencies.sendToRunner = (selected, command, options) => {
    sends.push({ command, options });
    return sendToRunner(selected, command, options);
  };
  const routes = createRunnerRoutes(dependencies);

  const invalid = response();
  await routes["POST /rpc"]({ body: {} }, invalid, new URL("http://localhost/rpc"));
  assert.equal(invalid.status, 400);

  const queued = response();
  await routes["POST /rpc"]({ body: { type: "prompt", message: "hello" } }, queued, new URL("http://localhost/rpc"));
  assert.equal(queued.status, 202);
  assert.deepEqual(queued.body, { queued: true, runner: "runner-1" });
  assert.deepEqual(sends[0].options, { autostart: true });
  assert.equal(runner.titledWith, undefined);

  const stateRefresh = response();
  await routes["POST /rpc"]({ body: { type: "get_state" } }, stateRefresh, new URL("http://localhost/rpc"));
  assert.deepEqual(sends[1].options, { autostart: false });
  const messageRefresh = response();
  await routes["POST /rpc"]({ body: { type: "get_messages" } }, messageRefresh, new URL("http://localhost/rpc"));
  assert.deepEqual(sends[2].options, { autostart: false });

  const unavailable = response();
  await routes["POST /rpc"]({ body: { type: "unavailable" } }, unavailable, new URL("http://localhost/rpc"));
  assert.equal(unavailable.status, 503);

  const listed = response();
  routes["GET /runners"]({}, listed);
  assert.deepEqual(listed.body, { runners: [{ id: "runner-1", alive: false }] });
});

test("runner stop and restart routes preserve selection, status, and delayed restart", () => {
  const { runner, state, intervals, dependencies } = setup();
  const familyStops = [];
  dependencies.stopRunnerFamily = (selected) => { familyStops.push(selected.id); dependencies.stopRunner(selected); };
  const routes = createRunnerRoutes(dependencies);

  const missing = response();
  routes["DELETE /runners"]({}, missing, new URL("http://localhost/runners?id=missing"));
  assert.equal(missing.status, 404);

  const stopped = response();
  routes["DELETE /runners"]({}, stopped, new URL("http://localhost/runners?id=runner-1"));
  assert.equal(stopped.status, 200);
  assert.equal(runner.stopped, true);
  assert.deepEqual(familyStops, ["runner-1"]);

  runner.stopped = false;
  const restarted = response();
  routes["POST /restart"]({}, restarted, new URL("http://localhost/restart"));
  assert.equal(restarted.status, 202);
  assert.equal(intervals[0].delay, 300);
  intervals[0].callback();
  assert.deepEqual(runner.proc, { pid: 42 });
  assert.equal(state.runners.has(runner.id), true);
});

test("managed subagent route runs a persisted child through an Oyster runner", async () => {
  const { state, dependencies } = setup();
  dependencies.sendToRunner = (runner, command) => {
    assert.equal(command.type, "prompt");
    queueMicrotask(() => {
      dependencies.subagentListener({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "implemented it" }], stopReason: "stop" },
      });
      dependencies.subagentListener({ type: "agent_settled" });
    });
    return !!runner.proc;
  };
  const route = createRunnerRoutes(dependencies)["POST /subagents"];
  const res = response();
  await route({ body: {
    parentSessionId: "parent-id",
    dir: "/allowed/project",
    name: "Loop iteration 1: item",
    prompt: "implement item",
  } }, res);

  const child = state.runners.get("child-runner");
  assert.deepEqual(child.initialArgs, [
    "--parent-session", "parent-id", "--name", "Loop iteration 1: item", "--exclude-tools", "loop",
  ]);
  assert.equal(child.stopped, true);
  assert.equal(child.subagentStatus, "succeeded");
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/x-ndjson; charset=utf-8");
  assert.equal(res.headers["x-accel-buffering"], "no");
  assert.equal(res.writableEnded, true);
  const events = res.chunks.flatMap((chunk) => chunk.trim().split("\n")).map((line) => JSON.parse(line));
  assert.deepEqual(events[0], { type: "started", runner: { id: "child-runner", dir: "/allowed/project" } });
  assert.equal(events.at(-1).type, "complete");
  assert.equal(events.at(-1).ok, true);
  assert.equal(events.at(-1).output, "implemented it");
});

test("managed subagent stream sends heartbeats and cancels on disconnect", async () => {
  const { state, intervals, cleared, dependencies } = setup();
  const route = createRunnerRoutes(dependencies)["POST /subagents"];
  const res = response();
  const running = route({ body: {
    parentSessionId: "parent-id",
    dir: "/allowed/project",
    name: "Loop iteration 1: item",
    prompt: "implement item",
  } }, res);
  await Promise.resolve();

  assert.equal(res.status, 200, "headers must be acknowledged before the subagent completes");
  assert.equal(JSON.parse(res.chunks[0]).type, "started");
  const heartbeat = intervals.find((entry) => entry.delay === 25_000);
  assert.ok(heartbeat);
  heartbeat.callback();
  assert.equal(JSON.parse(res.chunks.at(-1)).type, "heartbeat");

  res.emit("close");
  await running;
  const child = state.runners.get("child-runner");
  assert.equal(child.subagentStatus, "failed");
  assert.equal(child.stopped, true);
  assert.ok(cleared.length > 0, "disconnect must clear the heartbeat interval");
  assert.equal(res.writableEnded, false, "a disconnected stream must not write a completion event");
});

test("managed subagent route validates its parent, prompt, and working directory", async () => {
  const { dependencies } = setup();
  const route = createRunnerRoutes(dependencies)["POST /subagents"];
  const missingParent = response();
  await route({ body: { prompt: "work", name: "child" } }, missingParent);
  assert.equal(missingParent.status, 400);

  const forbidden = response();
  await route({ body: { parentSessionId: "parent", prompt: "work", name: "child", dir: "/outside" } }, forbidden);
  assert.equal(forbidden.status, 403);

  const array = response();
  await route({ body: [] }, array);
  assert.match(array.body.error, /JSON object/);

  const nonStringDir = response();
  await route({ body: { parentSessionId: "parent", prompt: "work", name: "child", dir: 42 } }, nonStringDir);
  assert.match(nonStringDir.body.error, /dir must be/);

  const oversizedMultibyteParent = response();
  await route({ body: { parentSessionId: "😀".repeat(129), prompt: "work", name: "child" } }, oversizedMultibyteParent);
  assert.match(oversizedMultibyteParent.body.error, /512 bytes/);
});

test("managed subagent route tolerates malformed events and cleans up send failures", async () => {
  const { state, dependencies } = setup();
  dependencies.sendToRunner = () => {
    assert.doesNotThrow(() => dependencies.subagentListener(null));
    assert.doesNotThrow(() => dependencies.subagentListener({
      type: "message_end",
      message: { role: "assistant", content: { unexpected: true }, stopReason: "stop" },
    }));
    throw new Error("send failed");
  };
  const route = createRunnerRoutes(dependencies)["POST /subagents"];
  const res = response();
  await route({ body: { parentSessionId: "parent", prompt: "work", name: "child" } }, res);

  const child = state.runners.get("child-runner");
  assert.equal(child.stopped, true);
  assert.equal(child.subagentStatus, "failed");
  const complete = JSON.parse(res.chunks.at(-1));
  assert.equal(complete.type, "complete");
  assert.equal(complete.ok, false);
  assert.equal(complete.errorLog, "send failed");
});

test("managed subagent route disposes observers that complete synchronously", async () => {
  const { dependencies } = setup();
  let disposed = 0;
  dependencies.observeRunner = (_runner, listener) => {
    listener({ type: "agent_settled" });
    return () => { disposed += 1; };
  };
  const res = response();
  await createRunnerRoutes(dependencies)["POST /subagents"]({
    body: { parentSessionId: "parent", prompt: "work", name: "child" },
  }, res);
  assert.equal(disposed, 1);
  assert.equal(JSON.parse(res.chunks.at(-1)).ok, true);
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
  assert.deepEqual(opened.body.runner, {
    id: "opened",
    dir: "/allowed/project",
    sessionRef: { backend: "jsonl", id: "jsonl-id", storagePath: "/sessions/valid.jsonl" },
  });

  const sqlite = response();
  await route({ body: { sessionKey: "sqlite-key" } }, sqlite);
  assert.equal(sqlite.status, 200);
  assert.deepEqual(sqlite.body.runner.sessionRef, {
    backend: "sqlite", id: "sqlite-id", storagePath: "/agent/sessions.sqlite",
  });
});

test("open-session rejects stale SQLite IDs and uses the persisted cwd", async () => {
  const { dependencies } = setup();
  dependencies.lookupSessionReference = (reference) => reference.id === "sqlite-id" ? { id: reference.id, cwd: "/allowed/stored" } : null;
  const route = createRunnerRoutes(dependencies)["POST /open-session"];

  const opened = response();
  await route({ body: { sessionKey: "sqlite-key", dir: "/allowed/requested" } }, opened);
  assert.equal(opened.status, 200);
  assert.equal(opened.body.runner.dir, "/allowed/stored");

  dependencies.sessionReferenceParam = () => ({ backend: "sqlite", id: "stale", storagePath: "/agent/sessions.sqlite" });
  const staleRoute = createRunnerRoutes(dependencies)["POST /open-session"];
  const stale = response();
  await staleRoute({ body: { sessionKey: "stale-key" } }, stale);
  assert.equal(stale.status, 404);
  assert.match(stale.body.error, /session not found: stale/);
});

test("open-session rejects malformed and ambiguous payloads", async () => {
  const { dependencies } = setup();
  const route = createRunnerRoutes(dependencies)["POST /open-session"];

  for (const body of [[], { dir: 12 }, { sessionKey: "sqlite-key", sessionPath: "valid.jsonl" }]) {
    const res = response();
    await route({ body }, res);
    assert.equal(res.status, 400);
  }
});

test("route construction rejects incomplete dependencies", () => {
  const { dependencies } = setup();
  assert.throws(
    () => createRunnerRoutes({ ...dependencies, state: { runners: new Map(), sseClients: [] } }),
    /sseClients Set/,
  );
  assert.throws(() => createRunnerRoutes({ ...dependencies, sendToRunner: null }), /sendToRunner must be a function/);
  assert.throws(() => createRunnerRoutes({ ...dependencies, subagentTimeoutMs: 0 }), /positive finite/);
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
