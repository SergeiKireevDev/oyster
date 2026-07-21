import test from "node:test";
import assert from "node:assert/strict";
import {
  groupRunnersByCwd,
  groupSessionFamilies,
  partitionSessionFamilies,
} from "../public/src/features/sessions/sessionPickerViewModel.js";

test("session sidebar groups runners by cwd in stable activity order", () => {
  const runners = [
    { id: "a", dir: "/work/one" },
    { id: "b", dir: "/work/two" },
    { id: "c", dir: "/work/one" },
  ];
  assert.deepEqual(groupRunnersByCwd(runners), [
    { cwd: "/work/one", runners: [runners[0], runners[2]] },
    { cwd: "/work/two", runners: [runners[1]] },
  ]);
});

test("session sidebar moves stopped processes below active processes on each update", () => {
  const stopped = { id: "stopped", dir: "/work", alive: false };
  const activeOne = { id: "active-one", dir: "/work", alive: true };
  const activeTwo = { id: "active-two", dir: "/work", alive: true };

  assert.deepEqual(groupRunnersByCwd([stopped, activeOne, activeTwo])[0].runners, [activeOne, activeTwo, stopped]);
  assert.deepEqual(groupRunnersByCwd([
    { ...stopped, alive: true },
    { ...activeOne, alive: false },
    activeTwo,
  ])[0].runners.map((runner) => runner.id), ["stopped", "active-two", "active-one"]);
});

const sessions = [
  { path: "/root.jsonl", name: "root" },
  { path: "/fork.jsonl", parentSession: "/root.jsonl", name: "fork" },
  { path: "/nested.jsonl", parentSession: "/fork.jsonl", name: "nested" },
  { path: "/standalone.jsonl", name: "standalone" },
];

test("session picker groups nested forks under their root in input order", () => {
  assert.deepEqual(groupSessionFamilies(sessions), [
    { session: sessions[0], forks: [sessions[1], sessions[2]] },
    { session: sessions[3], forks: [] },
  ]);
});

test("session picker groups SQLite families by opaque keys despite a shared database", () => {
  const sqlite = [
    { sessionKey: "ps1_root", path: "/agent/sessions.sqlite", name: "root" },
    { sessionKey: "ps1_fork", path: "/agent/sessions.sqlite", parentSessionKey: "ps1_root", name: "fork" },
  ];
  assert.deepEqual(groupSessionFamilies(sqlite), [{ session: sqlite[0], forks: [sqlite[1]] }]);
});

test("session picker partitions whole families by whether any member is alive", () => {
  const partition = partitionSessionFamilies(sessions, (session) => session.path === "/nested.jsonl");
  assert.deepEqual(partition, {
    active: [sessions[0], sessions[1], sessions[2]],
    inactive: [sessions[3]],
  });
});

test("session picker treats missing parents as independent roots without mutating input", () => {
  const orphan = { path: "/orphan.jsonl", parentSession: "/missing.jsonl" };
  const input = [orphan];
  assert.deepEqual(groupSessionFamilies(input), [{ session: orphan, forks: [] }]);
  assert.deepEqual(input, [orphan]);
});
