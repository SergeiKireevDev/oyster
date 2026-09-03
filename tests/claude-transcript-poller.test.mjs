import test from "node:test";
import assert from "node:assert/strict";
import { createClaudeTranscriptPoller } from "../public/src/runtime/claudeTranscriptPoller.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("Claude transcript poller only syncs and reloads the selected Claude runner", async () => {
  let runner = { id: "pi", harness: "pi", sessionId: "pi-session" };
  let syncs = 0;
  let reloads = 0;
  const poller = createClaudeTranscriptPoller({
    getRunner: () => runner,
    sync: async () => { syncs++; return { changed: true }; },
    reload: async () => { reloads++; },
  });
  await poller.tick();
  assert.equal(syncs, 0);
  runner = { id: "claude", harness: "claude-code", sessionId: "cc-session" };
  await poller.tick();
  assert.equal(syncs, 1);
  assert.equal(reloads, 1);
  poller.teardown();
});

test("Claude transcript poller ignores unchanged and stale sync results", async () => {
  let runner = { id: "claude", harness: "claude-code", sessionId: "cc-session" };
  let resolveSync;
  let reloads = 0;
  const poller = createClaudeTranscriptPoller({
    getRunner: () => runner,
    sync: () => new Promise((resolve) => { resolveSync = resolve; }),
    reload: async () => { reloads++; },
  });
  const pending = poller.tick();
  await flush();
  runner = { id: "other", harness: "claude-code", sessionId: "other-session" };
  resolveSync({ changed: true });
  await pending;
  assert.equal(reloads, 0);

  let syncs = 0;
  const unchanged = createClaudeTranscriptPoller({
    getRunner: () => runner,
    sync: async () => { syncs++; return { changed: false }; },
    reload: async () => { reloads++; },
  });
  await unchanged.tick();
  assert.equal(syncs, 1);
  assert.equal(reloads, 0);
  poller.teardown();
  unchanged.teardown();
});

test("Claude transcript poller serializes overlapping interval ticks and tears down", async () => {
  const intervals = [];
  const cleared = [];
  let resolveSync;
  let syncs = 0;
  const poller = createClaudeTranscriptPoller({
    getRunner: () => ({ id: "claude", harness: "claude-code", sessionId: "cc-session" }),
    sync: () => { syncs++; return new Promise((resolve) => { resolveSync = resolve; }); },
    reload: async () => {},
    setIntervalImpl: (callback, delay) => { intervals.push({ callback, delay }); return 7; },
    clearIntervalImpl: (id) => cleared.push(id),
  });
  poller.start();
  await flush();
  assert.equal(intervals[0].delay, 2000);
  intervals[0].callback();
  await flush();
  assert.equal(syncs, 1);
  resolveSync({ changed: false });
  await flush();
  poller.teardown();
  assert.deepEqual(cleared, [7]);
});
