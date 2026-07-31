import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/src/components/AnalyticsModal.svelte", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

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

test("analytics modal uses explicit controls and data semantics", () => {
  assert.equal((source.match(/<button type="button"/g) ?? []).length, 2);
  assert.match(source, /<dl class="analytics-summary" aria-label="Usage totals">/);
  assert.match(source, /<time datetime=\{item\.bucket\}/);
  assert.match(source, /class="analytics-bar" aria-hidden="true"/);
  assert.match(source, /class="analytics-modal" aria-busy=\{\$analytics\.loading\}/);
});

test("analytics modal owns its specialized visual system and theme-aware chart palette", () => {
  assert.match(source, /<style>[\s\S]*--analytics-series-1:/);
  assert.match(globalStyles, /html\[data-theme="light"\] \.analytics-modal \{[\s\S]*--analytics-series-8:/);
  assert.match(source, /background: color-mix\(in srgb, var\(--panel-2\)/);
  assert.match(source, /@media \(max-width: 600px\)/);
  assert.match(source, /@media \(max-width: 520px\)/);
  assert.doesNotMatch(globalStyles, /\.analytics-controls/);
});

test("analytics loading, empty, error, and disabled states remain explicit", () => {
  assert.match(source, /Refreshing…/);
  assert.match(source, /analytics-state" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source, /analytics-error" role="alert"><strong>Couldn’t load usage<\/strong>/);
  assert.equal((source.match(/analytics-empty" role="status"/g) ?? []).length, 2);
  assert.match(source, /\.analytics-controls select:disabled, \.analytics-controls > button:disabled/);
});
