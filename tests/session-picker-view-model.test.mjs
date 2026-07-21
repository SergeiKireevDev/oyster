import test from "node:test";
import assert from "node:assert/strict";
import {
  groupSessionFamilies,
  partitionSessionFamilies,
} from "../public/src/features/sessions/sessionPickerViewModel.js";

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
