const METRICS = ["input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens"];
const SUPPORTED_BUCKETS = new Set(["hour", "day"]);

function emptyUsage() {
  return { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0, cost: 0 };
}

import { isNonArrayObject as isObject } from "../valuePredicates.mjs";

function nonnegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function addUsage(target, usage) {
  target.requests += 1;
  for (const metric of METRICS) target[metric] += nonnegativeNumber(usage[metric]);
  target.cost += nonnegativeNumber(isObject(usage.cost) ? usage.cost.total : undefined);
}

function bucketTimestamp(value, bucket) {
  if (value === null || value === undefined) return null;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCMinutes(0, 0, 0);
    if (bucket === "day") date.setUTCHours(0);
    return date.toISOString();
  } catch {
    return null;
  }
}

function dedupeKeys(record, message) {
  const keys = [];
  if (typeof message.responseId === "string" && message.responseId) keys.push(`response\u0000${message.responseId}`);
  if (typeof record.entryId === "string" && record.entryId) keys.push(`entry\u0000${record.entryId}`);
  return keys;
}

function usageRecord(record, bucket) {
  if (!isObject(record) || !isObject(record.message)) return null;
  const message = record.message;
  if (!isObject(message.usage) || typeof message.model !== "string" || !message.model) return null;
  if (message.provider != null && typeof message.provider !== "string") return null;
  const timestamp = bucketTimestamp(record.timestamp ?? message.timestamp, bucket);
  return timestamp ? { record, message, timestamp } : null;
}

function addUsageRecord({ models, series, total }, { message, timestamp }) {
  const model = `${message.provider ? `${message.provider}/` : ""}${message.model}`;
  if (!models.has(model)) models.set(model, { model, ...emptyUsage() });
  const seriesKey = `${timestamp}\u0000${model}`;
  if (!series.has(seriesKey)) series.set(seriesKey, { bucket: timestamp, model, ...emptyUsage() });
  addUsage(total, message.usage);
  addUsage(models.get(model), message.usage);
  addUsage(series.get(seriesKey), message.usage);
}

/** Aggregate assistant-message usage records, deduplicating copied fork entries by stable response or entry ID. */
export function aggregateUsageRecords(records, { bucket = "day" } = {}) {
  if (!SUPPORTED_BUCKETS.has(bucket)) throw new Error(`unsupported analytics bucket: ${bucket}`);
  const seen = new Set();
  const models = new Map();
  const series = new Map();
  const total = emptyUsage();

  for (const record of records ?? []) {
    const usage = usageRecord(record, bucket);
    if (!usage) continue;
    const { message } = usage;
    const dedupe = dedupeKeys(record, message);
    if (dedupe.some((key) => seen.has(key))) continue;
    for (const key of dedupe) seen.add(key);

    addUsageRecord({ models, series, total }, usage);
  }

  const clean = (row) => ({ ...row, cost: Number(row.cost.toFixed(6)) });
  return {
    bucket,
    total: clean(total),
    models: [...models.values()].map(clean).sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens || a.model.localeCompare(b.model)),
    series: [...series.values()].map(clean).sort((a, b) => a.bucket.localeCompare(b.bucket) || a.model.localeCompare(b.model)),
  };
}
