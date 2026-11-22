const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_WEEK = 604800;
const FRESH_MINUTES = 5;
const ERROR_RETRY_SECONDS = 60;
const RATE_LIMIT_BACKOFF_MINUTES = 5;
const MIN_FORCED_REFRESH_SECONDS = 30;
const REQUEST_TIMEOUT_SECONDS = 15;
const MAX_PERCENT = 100;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;

export const ANTHROPIC = "anthropic";
export const OPENAI_CODEX = "openai-codex";
export const SUBSCRIPTION_USAGE_PROVIDERS = Object.freeze([ANTHROPIC, OPENAI_CODEX]);

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

const FRESH_MS = FRESH_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const ERROR_RETRY_MS = ERROR_RETRY_SECONDS * MILLISECONDS_PER_SECOND;
const RATE_LIMIT_BACKOFF_MS = RATE_LIMIT_BACKOFF_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const MIN_FORCED_REFRESH_MS = MIN_FORCED_REFRESH_SECONDS * MILLISECONDS_PER_SECOND;
const REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function percent(value) {
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(number)) return null;
  return Math.min(MAX_PERCENT, Math.max(0, number));
}

function isoTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Unix seconds (Codex) versus milliseconds.
    const ms = value < 1e12 ? value * MILLISECONDS_PER_SECOND : value;
    return new Date(ms).toISOString();
  }
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return null;
}

function shortText(value, max = 60) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function usageWindow(id, label, usedPercent, resetsAt) {
  const used = percent(usedPercent);
  if (used === null) return null;
  return Object.freeze({ id, label, usedPercent: used, resetsAt: isoTime(resetsAt) });
}

const CLAUDE_GROUP_LABELS = Object.freeze({ session: "5-hour", five_hour: "5-hour", daily: "Daily", weekly: "Weekly", monthly: "Monthly" });
const CLAUDE_LEGACY_WINDOWS = Object.freeze([
  ["five_hour", "5-hour"],
  ["seven_day", "Weekly"],
  ["seven_day_opus", "Weekly · Opus"],
  ["seven_day_sonnet", "Weekly · Sonnet"],
]);

/** Reduce Claude's `/api/oauth/usage` payload to labelled percentage windows. */
export function normalizeClaudeUsage(payload) {
  if (!record(payload)) throw new TypeError("invalid Claude usage payload");
  const windows = [];
  if (Array.isArray(payload.limits) && payload.limits.length) {
    payload.limits.forEach((limit, index) => {
      if (!record(limit)) return;
      const base = CLAUDE_GROUP_LABELS[limit.group] ?? CLAUDE_GROUP_LABELS[limit.kind] ?? shortText(limit.group) ?? "Limit";
      const model = shortText(limit.scope?.model?.display_name);
      const surface = shortText(typeof limit.scope?.surface === "string" ? limit.scope.surface : limit.scope?.surface?.display_name);
      const scope = model ?? surface;
      const entry = usageWindow(`${shortText(limit.kind) ?? "limit"}-${index}`, scope ? `${base} · ${scope}` : base, limit.percent, limit.resets_at);
      if (entry) windows.push(entry);
    });
  } else {
    for (const [key, label] of CLAUDE_LEGACY_WINDOWS) {
      const value = payload[key];
      if (!record(value)) continue;
      const entry = usageWindow(key, label, value.utilization, value.resets_at);
      if (entry) windows.push(entry);
    }
  }
  const extra = payload.extra_usage;
  if (record(extra) && extra.is_enabled === true) {
    const entry = usageWindow("extra_usage", "Extra usage", extra.utilization, null);
    if (entry) windows.push(entry);
  }
  return Object.freeze({ plan: null, windows: Object.freeze(windows) });
}

function windowLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Limit";
  if (seconds === SECONDS_PER_WEEK) return "Weekly";
  if (seconds % SECONDS_PER_DAY === 0) return `${seconds / SECONDS_PER_DAY}-day`;
  if (seconds % SECONDS_PER_HOUR === 0) return `${seconds / SECONDS_PER_HOUR}-hour`;
  return `${Math.round(seconds / SECONDS_PER_MINUTE)}-minute`;
}

function codexWindows(rateLimit, prefix, idPrefix) {
  if (!record(rateLimit)) return [];
  const result = [];
  for (const key of ["primary_window", "secondary_window"]) {
    const value = rateLimit[key];
    if (!record(value)) continue;
    const label = windowLabel(value.limit_window_seconds);
    const resetsAt = value.reset_at ?? (Number.isFinite(value.reset_after_seconds) ? Date.now() + value.reset_after_seconds * MILLISECONDS_PER_SECOND : null);
    const entry = usageWindow(`${idPrefix}${key}`, prefix ? `${prefix} · ${label}` : label, value.used_percent, resetsAt);
    if (entry) result.push(entry);
  }
  return result;
}

/** Reduce ChatGPT's `/backend-api/wham/usage` payload; identity fields are dropped. */
export function normalizeCodexUsage(payload) {
  if (!record(payload)) throw new TypeError("invalid Codex usage payload");
  const windows = [...codexWindows(payload.rate_limit, null, "")];
  windows.push(...codexWindows(payload.code_review_rate_limit, "Code review", "code_review_"));
  if (Array.isArray(payload.additional_rate_limits)) {
    payload.additional_rate_limits.forEach((item, index) => {
      if (!record(item)) return;
      const name = shortText(item.limit_name) ?? shortText(item.metered_feature) ?? "Additional";
      windows.push(...codexWindows(item.rate_limit ?? item, name, `additional_${index}_`));
    });
  }
  return Object.freeze({ plan: shortText(payload.plan_type, 30), windows: Object.freeze(windows) });
}

const PROVIDERS = Object.freeze({
  [ANTHROPIC]: Object.freeze({
    url: CLAUDE_USAGE_URL,
    headers: () => ({ "anthropic-beta": "oauth-2025-04-20", "user-agent": "claude-code/oyster" }),
    normalize: normalizeClaudeUsage,
  }),
  [OPENAI_CODEX]: Object.freeze({
    url: CODEX_USAGE_URL,
    headers: (access) => ({ "user-agent": "codex_cli_rs", ...(access.accountId ? { "chatgpt-account-id": access.accountId } : {}) }),
    normalize: normalizeCodexUsage,
  }),
});

function usageError(code, message, retryAfterMs = null) {
  const error = new Error(message);
  error.code = code;
  error.retryAfterMs = retryAfterMs;
  return error;
}

function retryAfterMs(response) {
  const raw = response.headers?.get?.("retry-after");
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * MILLISECONDS_PER_SECOND;
  const date = Date.parse(raw ?? "");
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * Poll subscription usage for OAuth-connected providers. Both endpoints are
 * undocumented and rate-limited, so results are cached (in a host-owned map
 * that survives hot reloads), concurrent reads share one request, and errors
 * keep the last good value while backing off.
 */
export function createSubscriptionUsageService({
  readAccess,
  fetchImpl = fetch,
  now = Date.now,
  cache = new Map(),
  freshMs = FRESH_MS,
} = {}) {
  if (typeof readAccess !== "function") throw new TypeError("readAccess is required");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");

  async function request(provider, access) {
    const spec = PROVIDERS[provider];
    let response;
    try {
      response = await fetchImpl(spec.url, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${access.access}`, ...spec.headers(access) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw usageError("network", "Usage service unreachable");
    }
    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      throw usageError("rate_limited", "Usage endpoint is rate limited", retryAfterMs(response) ?? RATE_LIMIT_BACKOFF_MS);
    }
    if (response.status === HTTP_UNAUTHORIZED || response.status === HTTP_FORBIDDEN) {
      throw usageError("unauthorized", "Subscription credential was rejected");
    }
    if (!response.ok) throw usageError("upstream", `Usage endpoint returned ${response.status}`);
    let payload;
    try { payload = await response.json(); } catch { throw usageError("invalid_response", "Usage response was not JSON"); }
    try { return spec.normalize(payload); } catch { throw usageError("invalid_response", "Usage response had an unexpected shape"); }
  }

  function publicEntry(provider, entry) {
    return Object.freeze({
      provider,
      plan: entry.value?.plan ?? null,
      windows: entry.value?.windows ?? [],
      fetchedAt: entry.fetchedAt ? new Date(entry.fetchedAt).toISOString() : null,
      stale: Boolean(entry.error && entry.value),
      error: entry.error ? Object.freeze({ code: entry.error.code, message: entry.error.message }) : null,
    });
  }

  async function refresh(provider, entry) {
    let access;
    try { access = await readAccess(provider); } catch { access = null; }
    if (!access?.access) {
      cache.delete(provider);
      return null;
    }
    try {
      const value = await request(provider, access);
      const next = { value, error: null, fetchedAt: now(), attemptedAt: now(), retryAt: now() + freshMs };
      cache.set(provider, next);
      return next;
    } catch (error) {
      const next = {
        value: entry?.value ?? null,
        error: { code: error.code ?? "upstream", message: error.message },
        fetchedAt: entry?.fetchedAt ?? null,
        attemptedAt: now(),
        retryAt: now() + (error.retryAfterMs ?? ERROR_RETRY_MS),
      };
      cache.set(provider, next);
      return next;
    }
  }

  async function get(provider, { force = false } = {}) {
    if (!Object.hasOwn(PROVIDERS, provider)) return null;
    const entry = cache.get(provider);
    if (entry?.pending) return entry.pending;
    const due = !entry
      || now() >= entry.retryAt
      // A forced refresh still honours rate-limit backoff and a short floor.
      || (force && !entry.error && now() - entry.attemptedAt >= MIN_FORCED_REFRESH_MS);
    if (!due) return publicEntry(provider, entry);
    const pending = refresh(provider, entry).then((next) => (next ? publicEntry(provider, next) : null));
    cache.set(provider, { ...(entry ?? {}), pending });
    try {
      return await pending;
    } finally {
      const current = cache.get(provider);
      if (current?.pending === pending) {
        if (entry) cache.set(provider, entry);
        else cache.delete(provider);
      }
    }
  }

  async function list({ force = false } = {}) {
    const results = await Promise.all(SUBSCRIPTION_USAGE_PROVIDERS.map((provider) => get(provider, { force })));
    return results.filter(Boolean);
  }

  return Object.freeze({ get, list });
}
