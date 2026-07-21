import test from "node:test";
import assert from "node:assert/strict";
import {
  groupRunnersByCwd,
  groupSessionsByCwd,
  groupSessionFamilies,
  isSessionEntryArchived,
  partitionSessionFamilies,
  partitionSessionGroupsByArchive,
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

test("session query partitions stopped sessions by two-day head age", () => {
  const now = Date.parse("2026-07-17T12:00:00.000Z");
  const recent = { sessionKey: "recent", cwd: "/work", modifiedAt: "2026-07-16T12:00:01.000Z" };
  const old = { sessionKey: "old", cwd: "/work", modifiedAt: "2026-07-15T11:59:59.000Z" };
  const oldButAlive = { sessionKey: "alive", cwd: "/work", modifiedAt: "2026-07-01T00:00:00.000Z" };
  const manuallyArchived = { sessionKey: "manual", cwd: "/work", modifiedAt: "2026-07-17T11:59:00.000Z", archived: true };
  const aliveRunner = { id: "runner", alive: true };
  const groups = [{ cwd: "/work", entries: [
    { session: recent, runner: null },
    { session: old, runner: null },
    { session: oldButAlive, runner: aliveRunner },
    { session: manuallyArchived, runner: null },
  ] }];

  assert.equal(isSessionEntryArchived(groups[0].entries[0], now), false);
  assert.equal(isSessionEntryArchived(groups[0].entries[1], now), true);
  assert.equal(isSessionEntryArchived(groups[0].entries[2], now), false);
  assert.equal(isSessionEntryArchived(groups[0].entries[3], now), true);
  assert.deepEqual(partitionSessionGroupsByArchive(groups, now), [
    { cwd: "/work", entries: [groups[0].entries[0], groups[0].entries[2]], archived: false },
    { cwd: "/work", entries: [groups[0].entries[1], groups[0].entries[3]], archived: true, firstArchived: true },
  ]);
});

test("session sidebar groups all persisted sessions and matches their active runners", () => {
  const sessions = [
    { sessionKey: "ps1_old", id: "old", cwd: "/work", modifiedAt: "2026-01-01" },
    { sessionKey: "ps1_live", id: "live", cwd: "/work", modifiedAt: "2026-01-02" },
    { sessionKey: "ps1_other", id: "other", cwd: "/other", modifiedAt: "2026-01-03" },
  ];
  const runner = { id: "runner", dir: "/work", sessionKey: "ps1_live", sessionId: "live", alive: true };
  assert.deepEqual(groupSessionsByCwd(sessions, [runner]), [
    { cwd: "/work", entries: [{ session: sessions[1], runner }, { session: sessions[0], runner: null }] },
    { cwd: "/other", entries: [{ session: sessions[2], runner: null }] },
  ]);
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
