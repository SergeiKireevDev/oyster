import test from "node:test";
import assert from "node:assert/strict";
import { formatRelativeTime } from "../public/src/lib/relativeTime.js";

const at = (day, hour, minute = 0, second = 0) => new Date(2026, 6, day, hour, minute, second);
const NOW = at(18, 15).getTime();

test("relative session activity uses concise human labels", () => {
  assert.equal(formatRelativeTime(at(18, 14, 59, 30), NOW), "just now");
  assert.equal(formatRelativeTime(at(18, 14, 50), NOW), "10m ago");
  assert.equal(formatRelativeTime(at(18, 12), NOW), "3h ago");
  assert.equal(formatRelativeTime(at(17, 22), NOW), "yesterday");
  assert.equal(formatRelativeTime(at(15, 15), NOW), "3d ago");
  assert.equal(formatRelativeTime("invalid", NOW), "");
});
