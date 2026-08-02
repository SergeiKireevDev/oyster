import test from "node:test";
import assert from "node:assert/strict";
import { aggregateUsageRecords } from "../server/sessions/usageAnalytics.mjs";

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

test("usage analytics deduplicates copied entry IDs when response metadata differs", () => {
  const usage = { input: 10, output: 2, totalTokens: 12, cost: { total: 0.1 } };
  const result = aggregateUsageRecords([
    record("same-entry", "2026-01-01T10:00:00Z", "one", usage, "response-id"),
    { ...record("same-entry", "2026-01-01T10:00:00Z", "one", usage, ""), sessionId: "fork" },
  ]);
  assert.equal(result.total.requests, 1);
});

test("usage analytics only marks valid records as seen", () => {
  const usage = { input: 10, output: 2, totalTokens: 12, cost: { total: 0.1 } };
  const result = aggregateUsageRecords([
    record("invalid-copy", "not-a-date", "one", usage, "same-response"),
    record("valid-copy", "2026-01-01T10:00:00Z", "one", usage, "same-response"),
  ]);
  assert.equal(result.total.requests, 1);
  assert.equal(result.series[0].bucket, "2026-01-01T00:00:00.000Z");
});

test("usage analytics keeps response and entry ID namespaces distinct", () => {
  const usage = { input: 1, totalTokens: 1, cost: { total: 0.01 } };
  const result = aggregateUsageRecords([
    record("first-entry", "2026-01-01T10:00:00Z", "one", usage, "shared-id"),
    record("shared-id", "2026-01-01T11:00:00Z", "one", usage, ""),
  ]);
  assert.equal(result.total.requests, 2);
});

test("usage analytics does not guess identities for records without stable IDs", () => {
  const usage = { input: 1, totalTokens: 1, cost: { total: 0.01 } };
  const withoutIds = {
    sessionId: "session",
    timestamp: "2026-01-01T10:00:00Z",
    message: { role: "assistant", provider: "provider", model: "one", usage },
  };
  const result = aggregateUsageRecords([withoutIds, { ...withoutIds }]);
  assert.equal(result.total.requests, 2);
});

test("usage analytics ignores malformed records and unsafe numeric fields", () => {
  const result = aggregateUsageRecords([
    null,
    { message: null },
    { timestamp: null, message: { model: "epoch", usage: {} } },
    { timestamp: Symbol("invalid"), message: { model: "symbol", usage: {} } },
    { timestamp: "2026-01-01T10:00:00Z", message: { model: 42, usage: {} } },
    { timestamp: "2026-01-01T10:00:00Z", message: { model: "bad-provider", provider: 42, usage: {} } },
    record("valid", "2026-01-01T10:00:00Z", "one", {
      input: 3,
      output: -2,
      cacheRead: Infinity,
      cacheWrite: "4",
      reasoning: true,
      totalTokens: 3,
      cost: { total: Number.NaN },
    }),
  ]);
  assert.deepEqual(result.total, {
    requests: 1,
    input: 3,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens: 3,
    cost: 0,
  });
});

test("usage analytics rejects unsupported buckets", () => {
  assert.throws(() => aggregateUsageRecords([], { bucket: "week" }), /unsupported analytics bucket: week/);
});
