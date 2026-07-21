import test from "node:test";
import assert from "node:assert/strict";
import { createSessionRoutes } from "../http/routes/sessionRoutes.mjs";

function setup() {
  const stopped = [];
  const closed = [];
  const unlinked = [];
  const runner = { id: "r1", sessionFile: "/sessions/folder/a.jsonl", proc: {}, busy: true };
  const state = {
    currentDir: "/work",
    defaultRunnerId: "r1",
    runners: new Map([[runner.id, runner]]),
    tunnels: new Map([["t1", { id: "t1", port: 4000, sessionId: "session-a" }]]),
  };
  const dependencies = {
    state,
    requestContext: { json(res, status, body) { res.status = status; res.body = body; } },
    sessions: {
      root: "/sessions",
      sessionDirFor: (dir) => `/sessions/${dir.replaceAll("/", "-")}`,
      summarizeSessionFile: () => ({ id: "session-a", name: "A" }),
      listSessions: (dir) => [{ id: "session-a", path: "/sessions/folder/a.jsonl", dir }],
      listSessionFolders: () => ["/sessions/folder"],
      sessionEntries: (path) => [{ id: "entry", path }],
      sessionMessages: (path) => [{ role: "user", path }],
      findSessionById: (id) => id === "session-a" ? "/sessions/folder/a.jsonl" : null,
      readSessionHeaderInfo: () => ({ id: "session-a" }),
      sessionFileParam: (path) => path === "folder/a.jsonl" ? "/sessions/folder/a.jsonl" : null,
      sessionFileFromSearch: (url) => url.searchParams.get("path") === "folder/a.jsonl" ? "/sessions/folder/a.jsonl" : null,
    },
    runners: {
      stopRunner: (selected) => stopped.push(selected.id),
      runnersChanged: () => { state.runnersBroadcast = true; },
    },
    resources: {
      closeTunnel: (_state, id) => closed.push(id),
      releaseSessionRoutines: () => ["routine-a"],
    },
    resolvePath: (path) => path,
    unlinkFile: (path) => unlinked.push(path),
    logger: { log() {} },
  };
  return { state, stopped, closed, unlinked, routes: createSessionRoutes(dependencies) };
}

function response() { return {}; }

test("session listing preserves root scope and live runner annotations", () => {
  const { routes } = setup();
  const escaped = response();
  routes["GET /sessions"]({}, escaped, new URL("http://localhost/sessions?path=/sessions-escape"));
  assert.equal(escaped.status, 400);

  const listed = response();
  routes["GET /sessions"]({}, listed, new URL("http://localhost/sessions?path=/sessions/folder"));
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.sessions[0], {
    id: "session-a",
    path: "/sessions/folder/a.jsonl",
    dir: "/sessions/folder",
    runnerId: "r1",
    alive: true,
    busy: true,
  });
});

test("session lookup, entries, messages, and folders preserve response shapes", () => {
  const { routes } = setup();
  const lookup = response();
  routes["GET /session-by-id"]({}, lookup, new URL("http://localhost/session-by-id?id=session-a"));
  assert.deepEqual(lookup.body, { session: { path: "/sessions/folder/a.jsonl", id: "session-a", name: "A" } });

  const missingId = response();
  routes["GET /session-by-id"]({}, missingId, new URL("http://localhost/session-by-id"));
  assert.equal(missingId.status, 400);

  const entries = response();
  routes["GET /session-entries"]({}, entries, new URL("http://localhost/session-entries?path=folder/a.jsonl"));
  assert.deepEqual(entries.body, [{ id: "entry", path: "/sessions/folder/a.jsonl" }]);

  const messages = response();
  routes["GET /session-messages"]({}, messages, new URL("http://localhost/session-messages?path=missing"));
  assert.equal(messages.status, 404);

  const folders = response();
  routes["GET /session-folders"]({}, folders, new URL("http://localhost/session-folders?dir=/other"));
  assert.deepEqual(folders.body, { folders: ["/sessions/folder"], current: "/sessions/-other" });
});

test("deleting a session retires bound runners, hublots, and routines", () => {
  const { state, stopped, closed, unlinked, routes } = setup();
  const res = response();
  routes["DELETE /session"]({}, res, new URL("http://localhost/session?path=folder/a.jsonl"));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    deleted: "/sessions/folder/a.jsonl",
    closedHublots: [4000],
    releasedRoutines: ["routine-a"],
  });
  assert.deepEqual(stopped, ["r1"]);
  assert.deepEqual(closed, ["t1"]);
  assert.deepEqual(unlinked, ["/sessions/folder/a.jsonl"]);
  assert.equal(state.runners.size, 0);
  assert.equal(state.defaultRunnerId, null);
  assert.equal(state.runnersBroadcast, true);
});
