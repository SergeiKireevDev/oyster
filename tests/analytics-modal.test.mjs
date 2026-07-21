import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/src/components/AnalyticsModal.svelte", import.meta.url), "utf8");

test("analytics modal charts aggregated cost buckets instead of listing timeline rows", () => {
  assert.match(source, /class="analytics-chart"/);
  assert.match(source, /class="analytics-chart-bar"/);
  assert.match(source, /Cost over time/);
  assert.doesNotMatch(source, /analytics-time-row/);
});
