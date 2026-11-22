import test from "node:test";
import assert from "node:assert/strict";
import {
  createSubscriptionUsageService,
  normalizeClaudeUsage,
  normalizeCodexUsage,
} from "../server/subscription-usage-service.mjs";
import { createSubscriptionUsageRoutes } from "../server/http/routes/subscriptionUsageRoutes.mjs";
import { createCredentialsController } from "../public/src/features/credentials/createCredentialsController.js";

const TOKEN = "access-token-canary";

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    async json() { return body; },
  };
}

const CLAUDE_PAYLOAD = {
  five_hour: null,
  seven_day: { utilization: 14, resets_at: "2026-11-23T17:00:00.197316+00:00" },
  extra_usage: { is_enabled: false, utilization: 0 },
  limits: [
    { kind: "weekly_all", group: "weekly", percent: 14, resets_at: "2026-11-23T17:00:00.197316+00:00", scope: null },
    { kind: "weekly_scoped", group: "weekly", percent: 22, resets_at: "2026-11-23T17:00:00Z", scope: { model: { id: null, display_name: "Fable" }, surface: null } },
  ],
};

const CODEX_PAYLOAD = {
  user_id: "user-secret", account_id: "acct-secret", email: "person@example.com",
  plan_type: "pro",
  rate_limit: {
    primary_window: { used_percent: 37, limit_window_seconds: 18000, reset_at: 1795788264 },
    secondary_window: { used_percent: 120, limit_window_seconds: 604800, reset_at: 1795788264 },
  },
  code_review_rate_limit: null,
  additional_rate_limits: null,
};

test("Claude usage prefers the structured limits array and labels scoped limits", () => {
  const usage = normalizeClaudeUsage(CLAUDE_PAYLOAD);
  assert.equal(usage.plan, null);
  assert.deepEqual(usage.windows.map(({ label, usedPercent }) => [label, usedPercent]), [["Weekly", 14], ["Weekly · Fable", 22]]);
  assert.equal(usage.windows[0].resetsAt, "2026-11-23T17:00:00.197Z");
});

test("Claude usage falls back to the legacy utilization windows", () => {
  const usage = normalizeClaudeUsage({
    five_hour: { utilization: 3.5, resets_at: "2026-11-22T23:00:00Z" },
    seven_day: { utilization: 14, resets_at: "2026-11-23T17:00:00Z" },
    seven_day_opus: null,
    extra_usage: { is_enabled: true, utilization: 40 },
  });
  assert.deepEqual(usage.windows.map(({ id, label, usedPercent }) => [id, label, usedPercent]), [
    ["five_hour", "5-hour", 3.5], ["seven_day", "Weekly", 14], ["extra_usage", "Extra usage", 40],
  ]);
});

test("Codex usage keeps plan and windows, clamps percentages, and drops identity fields", () => {
  const usage = normalizeCodexUsage(CODEX_PAYLOAD);
  assert.equal(usage.plan, "pro");
  assert.deepEqual(usage.windows.map(({ label, usedPercent }) => [label, usedPercent]), [["5-hour", 37], ["Weekly", 100]]);
  assert.equal(usage.windows[0].resetsAt, new Date(1795788264 * 1000).toISOString());
  assert.doesNotMatch(JSON.stringify(usage), /secret|example\.com/);
});

test("usage service sends provider-specific auth headers and never exposes the token", async () => {
  const calls = [];
  const service = createSubscriptionUsageService({
    readAccess: async (provider) => ({ access: TOKEN, accountId: provider === "openai-codex" ? "acct-1" : null }),
    fetchImpl: async (url, options) => {
      calls.push({ url, headers: options.headers });
      return jsonResponse(200, url.includes("anthropic") ? CLAUDE_PAYLOAD : CODEX_PAYLOAD);
    },
  });
  const usage = await service.list();
  assert.deepEqual(usage.map((entry) => entry.provider), ["anthropic", "openai-codex"]);
  const claude = calls.find((call) => call.url.includes("anthropic"));
  const codex = calls.find((call) => call.url.includes("chatgpt"));
  assert.equal(claude.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(claude.headers["anthropic-beta"], "oauth-2025-04-20");
  assert.equal(codex.headers["chatgpt-account-id"], "acct-1");
  assert.doesNotMatch(JSON.stringify(usage), new RegExp(TOKEN));
});

test("usage service skips providers without an OAuth subscription", async () => {
  let fetched = 0;
  const service = createSubscriptionUsageService({
    readAccess: async (provider) => (provider === "anthropic" ? null : { access: TOKEN }),
    fetchImpl: async () => { fetched += 1; return jsonResponse(200, CODEX_PAYLOAD); },
  });
  assert.deepEqual((await service.list()).map((entry) => entry.provider), ["openai-codex"]);
  assert.equal(fetched, 1);
});

test("usage service caches, shares in-flight reads, and keeps stale data through rate limits", async () => {
  let clock = 1_000_000;
  let fetched = 0;
  const responses = [jsonResponse(200, CODEX_PAYLOAD), jsonResponse(429, {}, { "retry-after": "120" }), jsonResponse(200, CODEX_PAYLOAD)];
  const service = createSubscriptionUsageService({
    readAccess: async () => ({ access: TOKEN }),
    fetchImpl: async () => { fetched += 1; return responses.shift(); },
    now: () => clock,
    freshMs: 60_000,
  });
  const [first, second] = await Promise.all([service.get("openai-codex"), service.get("openai-codex")]);
  assert.equal(fetched, 1);
  assert.deepEqual(first, second);

  await service.get("openai-codex", { force: true });
  assert.equal(fetched, 1, "forced refresh has a short floor");

  clock += 61_000;
  const limited = await service.get("openai-codex");
  assert.equal(fetched, 2);
  assert.equal(limited.stale, true);
  assert.equal(limited.error.code, "rate_limited");
  assert.equal(limited.windows.length, 2);

  clock += 60_000;
  await service.get("openai-codex", { force: true });
  assert.equal(fetched, 2, "Retry-After is honoured even when forced");

  clock += 61_000;
  const recovered = await service.get("openai-codex");
  assert.equal(fetched, 3);
  assert.equal(recovered.error, null);
});

test("usage service reports rejected credentials without retrying immediately", async () => {
  let fetched = 0;
  const service = createSubscriptionUsageService({
    readAccess: async () => ({ access: TOKEN }),
    fetchImpl: async () => { fetched += 1; return jsonResponse(401, {}); },
  });
  const usage = await service.get("anthropic");
  assert.equal(usage.error.code, "unauthorized");
  assert.equal(usage.stale, false);
  await service.get("anthropic");
  assert.equal(fetched, 1);
});

test("subscription usage route returns the service list and forwards explicit refresh", async () => {
  const forced = [];
  const routes = createSubscriptionUsageRoutes({
    requestContext: { json(res, status, body) { res.status = status; res.body = body; } },
    usageService: { async list({ force }) { forced.push(force); return [{ provider: "anthropic", windows: [] }]; } },
  });
  assert.deepEqual(Object.keys(routes), ["GET /subscription-usage"]);
  const res = {};
  await routes["GET /subscription-usage"]({}, res, new URL("http://x/subscription-usage?refresh=1"));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { usage: [{ provider: "anthropic", windows: [] }] });
  assert.deepEqual(forced, [true]);
});

test("credentials controller loads usage only while visible and keys it by provider", async () => {
  const states = [];
  const paths = [];
  const controller = createCredentialsController({
    async fetchImpl(path) {
      paths.push(path);
      return jsonResponse(200, { usage: [{ provider: "anthropic", windows: [{ id: "w", label: "Weekly", usedPercent: 14 }] }] });
    },
    confirm: async () => true,
    setState: (patch) => states.push(patch),
  });
  assert.equal(await controller.loadUsage(), null);
  assert.deepEqual(paths, []);
  controller.activate();
  const usage = await controller.loadUsage();
  assert.deepEqual(paths, ["/subscription-usage"]);
  assert.equal(usage.anthropic.windows[0].usedPercent, 14);
  assert.deepEqual(states.at(-1), { usage });
  controller.teardown();
});
