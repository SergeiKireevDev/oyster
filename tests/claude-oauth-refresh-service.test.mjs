import test from "node:test";
import assert from "node:assert/strict";
import { createClaudeOAuthRefreshService } from "../server/claude-oauth-refresh-service.mjs";

const HOUR = 60 * 60 * 1000;
const quiet = { log() {}, warn() {}, error() {} };

function fakeSink({ expires, refresh = "refresh-one" } = {}) {
  const state = { credential: expires === undefined ? null : { type: "oauth", access: "access-one", refresh, expires, refreshExpires: null }, refreshes: [] };
  return {
    state,
    read: () => state.credential,
    async refresh(options) {
      state.refreshes.push(options);
      if (state.nextError) { const error = state.nextError; state.nextError = null; throw error; }
      state.credential = { type: "oauth", access: "access-two", refresh: "refresh-two", expires: state.credential.expires + 8 * HOUR, refreshExpires: 1_800_000_000_000 };
      return { ...state.credential, rotated: true };
    },
  };
}

function service(sink, overrides = {}) {
  const restarts = [];
  const timers = [];
  const created = createClaudeOAuthRefreshService({
    sink,
    restartRunners: async (options) => { restarts.push(options); return { status: "restarted", runnerIds: ["r1"] }; },
    now: () => 1_000 * HOUR,
    setTimer: (callback, delay) => { const timer = { callback, delay, unref() { timer.unrefed = true; } }; timers.push(timer); return timer; },
    clearTimer: (timer) => { timer.cleared = true; },
    logger: quiet,
    ...overrides,
  });
  return { service: created, restarts, timers };
}

test("Claude OAuth upkeep refreshes only inside the margin, then restarts idle runners", async () => {
  const fresh = fakeSink({ expires: 1_000 * HOUR + 5 * HOUR });
  const early = service(fresh);
  assert.deepEqual(await early.service.refreshNow({ reason: "scheduled" }), { outcome: "not_needed", reason: "scheduled", expiresAt: 1_005 * HOUR });
  assert.equal(fresh.state.refreshes.length, 0);
  assert.deepEqual(early.restarts, []);

  const due = fakeSink({ expires: 1_000 * HOUR + 20 * 60 * 1000 });
  const upkeep = service(due);
  const result = await upkeep.service.refreshNow({ reason: "scheduled" });
  assert.equal(result.outcome, "refreshed");
  assert.equal(result.rotated, true);
  assert.equal(result.expiresAt, due.state.credential.expires);
  assert.equal(result.refreshTokenExpiresAt, 1_800_000_000_000);
  assert.deepEqual(result.restart, { status: "restarted", runnerIds: ["r1"] });
  assert.deepEqual(upkeep.restarts, [{ reason: "scheduled" }]);
  assert.equal(due.state.refreshes.length, 1);
  assert.equal(upkeep.service.lastOutcome, result);

  const missing = service(fakeSink());
  assert.deepEqual(await missing.service.refreshNow(), { outcome: "not_configured", reason: "manual" });
});

test("Claude OAuth upkeep stops retrying a dead refresh token until a new grant is stored", async () => {
  const sink = fakeSink({ expires: 1_000 * HOUR });
  const errors = [];
  const { service: upkeep, restarts } = service(sink, { logger: { ...quiet, error: (message) => errors.push(message) } });
  sink.state.nextError = Object.assign(new Error("rejected"), { invalidGrant: true });

  const rejected = await upkeep.refreshNow({ reason: "scheduled" });
  assert.equal(rejected.outcome, "reauth_required");
  assert.match(errors[0], /re-authenticate Claude Code/);
  assert.deepEqual(await upkeep.refreshNow({ reason: "scheduled" }), { outcome: "reauth_required", reason: "scheduled", expiresAt: 1_000 * HOUR });
  assert.equal(sink.state.refreshes.length, 1, "a known-dead refresh token is not retried");
  assert.deepEqual(restarts, []);

  sink.state.credential = { ...sink.state.credential, refresh: "refresh-from-login" }; // UI re-login
  assert.equal((await upkeep.refreshNow({ reason: "scheduled" })).outcome, "refreshed");
  assert.equal(sink.state.refreshes.length, 2);

  sink.state.credential = { ...sink.state.credential, expires: 1_000 * HOUR };
  sink.state.nextError = new Error("ECONNRESET");
  const transient = await upkeep.refreshNow({ reason: "scheduled" });
  assert.equal(transient.outcome, "failed");
  assert.equal((await upkeep.refreshNow({ reason: "scheduled" })).outcome, "refreshed", "transient failures are retried");
});

test("Claude OAuth recovery after a runner 401 restarts runners even when the stored grant is already fresh", async () => {
  const sink = fakeSink({ expires: 1_000 * HOUR + 6 * HOUR });
  const { service: upkeep, restarts } = service(sink);
  const recovered = await upkeep.recover({ reason: "oauth_expired:r1" });
  assert.equal(recovered.outcome, "not_needed");
  assert.deepEqual(recovered.restart, { status: "restarted", runnerIds: ["r1"] });
  assert.deepEqual(restarts, [{ reason: "oauth_expired:r1" }]);
  assert.equal(sink.state.refreshes.length, 0);

  sink.state.credential = { ...sink.state.credential, expires: 1_000 * HOUR - HOUR };
  assert.equal((await upkeep.recover()).outcome, "refreshed");
  assert.equal(restarts.length, 2);
});

test("Claude OAuth upkeep shares one in-flight attempt and owns a single unrefed timer", async () => {
  const sink = fakeSink({ expires: 1_000 * HOUR });
  let release;
  sink.refresh = () => new Promise((resolve) => { release = () => resolve({ ...sink.state.credential, access: "access-two", rotated: true }); });
  const { service: upkeep, restarts, timers } = service(sink);

  const first = upkeep.refreshNow({ reason: "scheduled" });
  const second = upkeep.refreshNow({ reason: "runner_401" });
  assert.equal(first, second);
  release();
  assert.equal((await first).reason, "scheduled");
  assert.equal(restarts.length, 1);

  assert.equal(upkeep.running, false);
  const timer = upkeep.start();
  assert.equal(upkeep.start(), timer);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].unrefed, true);
  assert.equal(timers[0].delay, 60_000);
  timers[0].callback();
  assert.equal(timers.length, 2, "each tick schedules the next check");
  upkeep.stop();
  assert.equal(timers[1].cleared, true);
  assert.equal(upkeep.running, false);
  timers[1].callback();
  assert.equal(timers.length, 2, "a stopped service does not reschedule");
});

test("Claude OAuth upkeep validates its dependencies", () => {
  const sink = fakeSink({ expires: 0 });
  assert.throws(() => createClaudeOAuthRefreshService({ restartRunners() {} }), /credential sink is required/);
  assert.throws(() => createClaudeOAuthRefreshService({ sink, restartRunners: null }), /restartRunners must be a function/);
  assert.throws(() => createClaudeOAuthRefreshService({ sink, restartRunners() {}, marginMs: 0 }), /refresh margin/);
  assert.throws(() => createClaudeOAuthRefreshService({ sink, restartRunners() {}, intervalMs: -1 }), /check interval/);
});
