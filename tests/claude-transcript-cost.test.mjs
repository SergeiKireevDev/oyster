import test from "node:test";
import assert from "node:assert/strict";
import { claudeRecordsToSessionEntries } from "../server/runner-drivers/claude-transcript.mjs";
import { aggregateUsageRecords } from "../server/sessions/usageAnalytics.mjs";

const assistant = (uuid, extra = {}) => ({
  type: "assistant", uuid, timestamp: "2026-01-01T00:00:00Z",
  message: { id: `msg-${uuid}`, model: "claude-sonnet", content: [{ type: "text", text: "hello" }], usage: { input_tokens: 2, output_tokens: 1 } },
  ...extra,
});
const snapshot = (totalCostUSD, extra = {}) => ({ type: "cost-state", totalCostUSD, ...extra });
const costs = (entries) => entries.map((entry) => entry.message.usage.cost.total);
const analytics = (entries) => aggregateUsageRecords(entries.map((entry) => ({ ...entry, entryId: entry.id })));

test("Claude imports cumulative cost snapshots once, without adding transcript messages", () => {
  const records = [assistant("a"), snapshot(0.25), snapshot(0.25), assistant("b"), snapshot(0.75), snapshot(0.75)];
  const original = structuredClone(records);
  const entries = claudeRecordsToSessionEntries(records);
  assert.deepEqual(costs(entries), [0.25, 0.5]);
  assert.deepEqual(entries.map((entry) => entry.id), ["a", "b"]);
  assert.equal(entries[1].parentId, "a");
  assert.deepEqual(entries[1].message.usage.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 });
  assert.equal(analytics(entries).total.cost, 0.75);
  assert.equal(analytics(entries).total.totalTokens, 6);
  assert.deepEqual(records, original, "conversion must not mutate the native transcript");
  assert.deepEqual(claudeRecordsToSessionEntries(records), entries, "reconciliation is deterministic");
});

test("Claude snapshots fill only cost not already supplied by assistant records", () => {
  const entries = claudeRecordsToSessionEntries([
    assistant("a", { total_cost_usd: 0.125 }), assistant("b", { total_cost_usd: 0.125 }), snapshot(0.5),
    assistant("c", { total_cost_usd: 0.25 }), snapshot(1),
  ]);
  assert.deepEqual(costs(entries), [0.125, 0.375, 0.5]);
  assert.equal(analytics(entries).total.cost, 1);
});

test("Claude ignores missing, malformed, sidechain, and stale cost snapshots", () => {
  const entries = claudeRecordsToSessionEntries([
    snapshot(0), assistant("a"), snapshot(0.25),
    ...[undefined, null, "10", -1, NaN, Infinity, 0, 0.125].map((total) => snapshot(total)),
    snapshot(100, { isSidechain: true }),
    assistant("side", { isSidechain: true }), snapshot(0.25), assistant("b"),
  ]);
  assert.deepEqual(costs(entries), [0.25, 0]);
  assert.deepEqual(costs(claudeRecordsToSessionEntries([assistant("a")])), [0]);
  assert.deepEqual(claudeRecordsToSessionEntries([snapshot(1)]), []);
});

test("Claude split responses retain snapshot costs after analytics response-ID deduplication", () => {
  const first = assistant("a");
  const second = assistant("b", { message: { ...first.message, content: [{ type: "text", text: "second block" }] } });
  const entries = claudeRecordsToSessionEntries([first, second, snapshot(0.25), snapshot(0.5)]);
  assert.deepEqual(costs(entries), [0.5, 0.5], "both first and last parts expose the response cost");
  assert.equal(analytics(entries).total.cost, 0.5);
  assert.equal(analytics(entries).total.requests, 1);
});
