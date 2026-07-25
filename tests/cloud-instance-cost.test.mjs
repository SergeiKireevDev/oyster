import test from "node:test";
import assert from "node:assert/strict";
import { cumulativeInstanceCost, instancePricing } from "../public/src/features/cloud/instanceCost.js";

test("cloud instance pricing selects a regional catalog rate and falls back to monthly pricing", () => {
  assert.deepEqual(instancePricing({ pricingByRegion: { nbg1: { hourly: "0.01", monthly: "5", currency: "eur" } } }, "nbg1"), {
    hourly: 0.01,
    monthly: 5,
    currency: "EUR",
  });
  assert.equal(instancePricing({ pricing: { monthly: 7.3, currency: "USD" } }, "nyc3").hourly, 0.01);
  assert.equal(instancePricing({}, "nyc3"), null);
});

test("cumulative cloud instance cost applies catalog monthly caps to each calendar month", () => {
  const start = Date.UTC(2026, 0, 1);
  assert.equal(cumulativeInstanceCost({ hourly: 1, monthly: 10 }, start, start + 5 * 60 * 60 * 1000), 5);
  assert.equal(cumulativeInstanceCost({ hourly: 1, monthly: 10 }, start, start + 20 * 60 * 60 * 1000), 10);
  const acrossMonth = cumulativeInstanceCost(
    { hourly: 1, monthly: 10 },
    Date.UTC(2026, 0, 31, 18),
    Date.UTC(2026, 1, 1, 6),
  );
  assert.equal(acrossMonth, 12, "each six-hour calendar-month segment remains below its cap");
});
