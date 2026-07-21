const METRICS = ["input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens"];

function emptyUsage() {
  return { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0, cost: 0 };
}

function addUsage(target, usage) {
  target.requests += 1;
  for (const metric of METRICS) target[metric] += Number(usage?.[metric] ?? 0) || 0;
  target.cost += Number(usage?.cost?.total ?? 0) || 0;
}

function bucketTimestamp(value, bucket) {
  const date = new Date(value);
  if (Number.isNaN(+date)) return null;
  date.setUTCMinutes(0, 0, 0);
  if (bucket === "day") date.setUTCHours(0);
  return date.toISOString();
}

/** Aggregate assistant-message usage records, deduplicating copied fork entries by response ID. */
export function aggregateUsageRecords(records, { bucket = "day" } = {}) {
  if (!new Set(["hour", "day"]).has(bucket)) throw new Error(`unsupported analytics bucket: ${bucket}`);
  const seen = new Set();
  const models = new Map();
  const series = new Map();
  const total = emptyUsage();

  for (const record of records ?? []) {
    const message = record.message ?? {};
    if (!message.usage || !message.model) continue;
    const dedupe = message.responseId || record.entryId || `${record.sessionId}:${record.timestamp}:${message.model}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const timestamp = bucketTimestamp(record.timestamp ?? message.timestamp, bucket);
    if (!timestamp) continue;
    const model = `${message.provider ? `${message.provider}/` : ""}${message.model}`;
    if (!models.has(model)) models.set(model, { model, ...emptyUsage() });
    const seriesKey = `${timestamp}\u0000${model}`;
    if (!series.has(seriesKey)) series.set(seriesKey, { bucket: timestamp, model, ...emptyUsage() });
    addUsage(total, message.usage);
    addUsage(models.get(model), message.usage);
    addUsage(series.get(seriesKey), message.usage);
  }

  const clean = (row) => ({ ...row, cost: Number(row.cost.toFixed(6)) });
  return {
    bucket,
    total: clean(total),
    models: [...models.values()].map(clean).sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens || a.model.localeCompare(b.model)),
    series: [...series.values()].map(clean).sort((a, b) => a.bucket.localeCompare(b.bucket) || a.model.localeCompare(b.model)),
  };
}
