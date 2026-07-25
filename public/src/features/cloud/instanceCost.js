const HOUR_MS = 60 * 60 * 1000;

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** Select the provider catalog rate for an instance type and region. */
export function instancePricing(size, region) {
  if (!size) return null;
  const regional = size.pricingByRegion?.[region];
  const source = regional || size.pricing;
  if (!source) return null;
  const hourly = positiveNumber(source.hourly);
  const monthly = positiveNumber(source.monthly);
  if (!hourly && !monthly) return null;
  return {
    hourly: hourly || monthly / 730,
    monthly,
    currency: String(source.currency || "USD").toUpperCase(),
  };
}

/**
 * Estimate compute charges from the provider's catalog rate. Monthly caps are
 * applied independently to each UTC calendar month. This intentionally does
 * not claim to include storage, traffic, taxes, credits, or discounts.
 */
export function cumulativeInstanceCost(pricing, createdAt, now = Date.now()) {
  const hourly = positiveNumber(pricing?.hourly);
  if (!hourly) return null;
  const start = new Date(createdAt).getTime();
  const end = new Date(now).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const monthly = positiveNumber(pricing?.monthly);
  let cursor = start;
  let total = 0;
  while (cursor < end) {
    const date = new Date(cursor);
    const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    const segmentEnd = Math.min(end, nextMonth);
    const hourlyCost = (segmentEnd - cursor) / HOUR_MS * hourly;
    total += monthly ? Math.min(hourlyCost, monthly) : hourlyCost;
    cursor = segmentEnd;
  }
  return total;
}
