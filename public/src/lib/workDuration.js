export function messageTimestampMs(value, fallback = NaN) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Find the latest user turn and the last timestamp rendered after it. */
export function latestTranscriptWorkPeriod(items) {
  let period = null;
  for (const item of items) {
    const timestamp = messageTimestampMs(item.timestamp);
    if (item.kind === "user") {
      if (Number.isFinite(timestamp)) period = { startedAt: timestamp, endedAt: timestamp };
      continue;
    }
    if (period && Number.isFinite(timestamp)) period.endedAt = Math.max(period.endedAt, timestamp);
  }
  return period;
}

/** Format elapsed work without rolling minutes or seconds past 59. */
export function formatWorkDuration(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(elapsedMs) / 1000) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours} hr`);
  if (hours || minutes) parts.push(`${minutes} min`);
  parts.push(`${seconds} sec`);
  return parts.join(" ");
}
