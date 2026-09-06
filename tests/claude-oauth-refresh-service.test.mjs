import test from "node:test";
import assert from "node:assert/strict";
import { createClaudeOAuthRefreshService } from "../server/claude-oauth-refresh-service.mjs";

const HOUR = 60 * 60 * 1000;
const quiet = { log() {}, warn() {}, error() {} };

function harness({ outcomes = [], overrides = {} } = {}) {
  const calls = [];
  const restarts = [];
  const timers = [];
  const service = createClaudeOAuthRefreshService({
    rotate: async (options) => { calls.push(options); const next = outcomes.shift(); if (next instanceof Error) throw next; return next ?? { outcome: "not_needed", reason: options.reason, expiresAt: 5 * HOUR }; },
    restartRunners: async (options) => { restarts.push(options); return { status: "restarted", runnerIds: ["r1"] }; },
    setTimer: (callback, delay) => { const timer = { callback, delay, unref() { timer.unrefed = true; } }; timers.push(timer); return timer; },
    clearTimer: (timer) => { timer.cleared = true; },
    logger: quiet,
    ...overrides,
  });
  return { service, calls, restarts, timers };
}

test("Anthropic OAuth upkeep passes the margin to the credential service and restarts idle runners after a rotation", async () => {
  const refreshed = { outcome: "refreshed", reason: "scheduled", rotated: true, expiresAt: 8 * HOUR, refreshTokenExpiresAt: 30 * 24 * HOUR };
  const { service, calls, restarts } = harness({ outcomes: [{ outcome: "not_needed", reason: "scheduled", expiresAt: 5 * HOUR }, refreshed, { outcome: "not_configured", reason: "manual" }] });

  assert.deepEqual(await service.refreshNow({ reason: "scheduled" }), { outcome: "not_needed", reason: "scheduled", expiresAt: 5 * HOUR });
  assert.deepEqual(calls, [{ reason: "scheduled", force: false, marginMs: 30 * 60 * 1000 }]);
  assert.deepEqual(restarts, []);

  const result = await service.refreshNow({ reason: "scheduled" });
  assert.deepEqual(result, { ...refreshed, restart: { status: "restarted", runnerIds: ["r1"] } });
  assert.deepEqual(restarts, [{ reason: "scheduled" }]);
  assert.equal(service.lastOutcome, result);

  assert.deepEqual(await service.refreshNow(), { outcome: "not_configured", reason: "manual" });
  assert.equal(calls.at(-1).force, false);
});

test("Anthropic OAuth upkeep reports re-authentication once and keeps retrying transient failures", async () => {
  const errors = [];
  const warnings = [];
  const { service, restarts } = harness({
    outcomes: [
      { outcome: "reauth_required", reason: "scheduled", expiresAt: HOUR },
      { outcome: "reauth_required", reason: "scheduled", expiresAt: HOUR },
      { outcome: "failed", reason: "scheduled", expiresAt: HOUR, error: "ECONNRESET" },
      new Error("adapter unavailable"),
      { outcome: "refreshed", reason: "scheduled", rotated: false, expiresAt: 9 * HOUR, refreshTokenExpiresAt: null },
    ],
    overrides: { logger: { log() {}, warn: (message) => warnings.push(message), error: (message) => errors.push(message) } },
  });

  assert.equal((await service.refreshNow({ reason: "scheduled" })).outcome, "reauth_required");
  assert.equal((await service.refreshNow({ reason: "scheduled" })).outcome, "reauth_required");
  assert.equal(errors.length, 1, "a dead refresh token is logged once, not every minute");
  assert.match(errors[0], /re-authenticate/);
  assert.equal((await service.refreshNow({ reason: "scheduled" })).outcome, "failed");
  assert.deepEqual(await service.refreshNow({ reason: "scheduled" }), { outcome: "failed", reason: "scheduled", error: "adapter unavailable" });
  assert.equal(warnings.length, 2);
  assert.equal((await service.refreshNow({ reason: "scheduled" })).outcome, "refreshed");
  assert.deepEqual(restarts, [{ reason: "scheduled" }]);
});

test("Anthropic OAuth recovery after a runner 401 restarts runners even when the grant is already fresh", async () => {
  const { service, calls, restarts } = harness({ outcomes: [{ outcome: "not_needed", reason: "oauth_expired:r1", expiresAt: 6 * HOUR }, { outcome: "refreshed", reason: "runner_401", rotated: true, expiresAt: 9 * HOUR, refreshTokenExpiresAt: null }, { outcome: "reauth_required", reason: "runner_401", expiresAt: HOUR }] });
  const recovered = await service.recover({ reason: "oauth_expired:r1" });
  assert.equal(recovered.outcome, "not_needed");
  assert.deepEqual(recovered.restart, { status: "restarted", runnerIds: ["r1"] });
  assert.deepEqual(calls[0], { reason: "oauth_expired:r1", force: false, marginMs: 30 * 60 * 1000 });
  assert.equal((await service.recover()).outcome, "refreshed");
  assert.equal(restarts.length, 2);
  assert.equal((await service.recover()).outcome, "reauth_required");
  assert.equal(restarts.length, 2, "nothing to restart into when re-authentication is required");
});

test("Anthropic OAuth upkeep shares one in-flight attempt and owns a single unrefed timer", async () => {
  let release;
  const { service, restarts, timers } = harness({ overrides: { rotate: () => new Promise((resolve) => { release = () => resolve({ outcome: "refreshed", reason: "scheduled", rotated: true, expiresAt: 9 * HOUR, refreshTokenExpiresAt: null }); }) } });

  const first = service.refreshNow({ reason: "scheduled" });
  const second = service.refreshNow({ reason: "runner_401" });
  assert.equal(first, second);
  release();
  assert.equal((await first).reason, "scheduled");
  assert.equal(restarts.length, 1);

  assert.equal(service.running, false);
  const timer = service.start();
  assert.equal(service.start(), timer);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].unrefed, true);
  assert.equal(timers[0].delay, 60_000);
  timers[0].callback();
  assert.equal(timers.length, 2, "each tick schedules the next check");
  service.stop();
  assert.equal(timers[1].cleared, true);
  assert.equal(service.running, false);
  timers[1].callback();
  assert.equal(timers.length, 2, "a stopped service does not reschedule");
});

test("Anthropic OAuth upkeep validates its dependencies", () => {
  assert.throws(() => createClaudeOAuthRefreshService({ restartRunners() {} }), /rotate must be a function/);
  assert.throws(() => createClaudeOAuthRefreshService({ rotate() {}, restartRunners: null }), /restartRunners must be a function/);
  assert.throws(() => createClaudeOAuthRefreshService({ rotate() {}, restartRunners() {}, marginMs: 0 }), /refresh margin/);
  assert.throws(() => createClaudeOAuthRefreshService({ rotate() {}, restartRunners() {}, intervalMs: -1 }), /check interval/);
});
