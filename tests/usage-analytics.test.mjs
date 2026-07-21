import test from "node:test";
import assert from "node:assert/strict";
import { aggregateUsageRecords } from "../sessions/usageAnalytics.mjs";

const record = (entryId, timestamp, model, usage, responseId = entryId) => ({
  sessionId: "session", entryId, timestamp,
  message: { role: "assistant", provider: "provider", model, responseId, usage },
});

test("usage analytics aggregates by model and hour", () => {
  const result = aggregateUsageRecords([
    record("a", "2026-01-01T10:10:00Z", "one", { input: 10, output: 2, totalTokens: 12, cost: { total: 0.1 } }),
    record("b", "2026-01-01T10:50:00Z", "one", { input: 5, output: 3, cacheRead: 20, totalTokens: 28, cost: { total: 0.2 } }),
    record("c", "2026-01-01T11:00:00Z", "two", { input: 4, output: 1, totalTokens: 5, cost: { total: 0.05 } }),
  ], { bucket: "hour" });
  assert.deepEqual(result.total, { requests: 3, input: 19, output: 6, cacheRead: 20, cacheWrite: 0, reasoning: 0, totalTokens: 45, cost: 0.35 });
  assert.equal(result.models[0].model, "provider/one");
  assert.equal(result.models[0].requests, 2);
  assert.deepEqual(result.series.map(({ bucket, model, requests }) => ({ bucket, model, requests })), [
    { bucket: "2026-01-01T10:00:00.000Z", model: "provider/one", requests: 2 },
    { bucket: "2026-01-01T11:00:00.000Z", model: "provider/two", requests: 1 },
  ]);
});

test("usage analytics deduplicates response IDs copied into forks", () => {
  const usage = { input: 10, output: 2, totalTokens: 12, cost: { total: 0.1 } };
  const result = aggregateUsageRecords([
    record("a", "2026-01-01T10:00:00Z", "one", usage, "same-response"),
    { ...record("copied", "2026-01-01T10:00:00Z", "one", usage, "same-response"), sessionId: "fork" },
  ]);
  assert.equal(result.total.requests, 1);
  assert.equal(result.total.cost, 0.1);
});
