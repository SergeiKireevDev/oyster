import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/src/components/AnalyticsModal.svelte", import.meta.url), "utf8");

test("analytics modal charts aggregated cost buckets instead of listing timeline rows", () => {
  assert.match(source, /class="analytics-chart"/);
  assert.match(source, /class="analytics-chart-bar"/);
  assert.match(source, /Cost over time/);
  assert.match(source, /item\.modelCosts\.set\(model, \(item\.modelCosts\.get\(model\) \?\? 0\) \+ cost\)/);
  assert.doesNotMatch(source, /analytics-time-row/);
});

test("analytics modal handles zero and malformed values without misleading chart bars", () => {
  assert.match(source, /Number\.isFinite\(numericValue\) \? numericValue : 0/);
  assert.match(source, /total > 0 && value > 0 \? Math\.max\(minimum,/);
  assert.match(source, /No cost data in this range\./);
});

test("analytics modal uses explicit button and time semantics", () => {
  assert.equal((source.match(/<button type="button"/g) ?? []).length, 2);
  assert.match(source, /<time datetime=\{item\.bucket\}/);
  assert.match(source, /class="analytics-bar" aria-hidden="true"/);
});
