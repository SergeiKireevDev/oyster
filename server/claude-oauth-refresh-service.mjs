/**
 * oyster — Claude Code OAuth token upkeep
 *
 * Headless Claude Code runners load `.credentials.json` once and only refresh
 * the grant themselves within five minutes of expiry. A runner that idles
 * across that window sends its stale token, receives a non-retryable 401, and
 * dies. Oyster therefore owns the lifecycle: it rotates the grant well before
 * Claude's own window (so the two never race over the single-use refresh
 * token), then restarts idle runners so they reload the file. A runner that
 * still reports an OAuth failure triggers the same recovery on demand.
 */

const DEFAULT_MARGIN_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 60 * 1000;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
}

function requirePositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be a positive number`);
}

function isoOrNull(timestamp) {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function createClaudeOAuthRefreshService({
  sink,
  restartRunners,
  marginMs = DEFAULT_MARGIN_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  fetchImpl = undefined,
  logger = console,
} = {}) {
  if (!sink || typeof sink !== "object") throw new TypeError("Claude OAuth credential sink is required");
  requireFunction(sink.read, "sink.read");
  requireFunction(sink.refresh, "sink.refresh");
  requireFunction(restartRunners, "restartRunners");
  requirePositive(marginMs, "refresh margin");
  requirePositive(intervalMs, "refresh check interval");
  requireFunction(now, "clock");
  requireFunction(setTimer, "timer scheduler");
  requireFunction(clearTimer, "timer clearer");
  requireFunction(logger?.log, "logger.log");
  requireFunction(logger?.warn, "logger.warn");
  requireFunction(logger?.error, "logger.error");

  let timer = null;
  let inFlight = null;
  let deadRefreshToken = null;
  let lastOutcome = null;

  function due(credential) {
    return credential.expires - now() <= marginMs;
  }

  async function restart(reason) {
    try {
      return await restartRunners({ reason });
    } catch (error) {
      logger.error(`[oyster] Claude Code runner restart after OAuth ${reason} failed: ${errorMessage(error)}`);
      return null;
    }
  }

  async function perform({ reason, force }) {
    const credential = sink.read();
    if (!credential) return Object.freeze({ outcome: "not_configured", reason });
    if (!force && !due(credential)) return Object.freeze({ outcome: "not_needed", reason, expiresAt: credential.expires });
    if (deadRefreshToken !== null && credential.refresh === deadRefreshToken) {
      return Object.freeze({ outcome: "reauth_required", reason, expiresAt: credential.expires });
    }
    let refreshed;
    try {
      refreshed = await sink.refresh(fetchImpl ? { fetchImpl, now } : { now });
    } catch (error) {
      if (error?.invalidGrant) {
        deadRefreshToken = credential.refresh;
        logger.error(`[oyster] Claude Code OAuth refresh rejected (${reason}); re-authenticate Claude Code from the Credentials modal`);
        return Object.freeze({ outcome: "reauth_required", reason, expiresAt: credential.expires, error: errorMessage(error) });
      }
      logger.warn(`[oyster] Claude Code OAuth refresh failed (${reason}); will retry: ${errorMessage(error)}`);
      return Object.freeze({ outcome: "failed", reason, expiresAt: credential.expires, error: errorMessage(error) });
    }
    deadRefreshToken = null;
    logger.log(`[oyster] Claude Code OAuth token ${refreshed.rotated ? "refreshed" : "adopted from a concurrent login"} (${reason}); `
      + `access expires ${isoOrNull(refreshed.expires)}, refresh token expires ${isoOrNull(refreshed.refreshExpires) ?? "unknown"}`);
    const restarted = await restart(reason);
    return Object.freeze({
      outcome: "refreshed",
      reason,
      rotated: refreshed.rotated,
      expiresAt: refreshed.expires,
      refreshTokenExpiresAt: refreshed.refreshExpires,
      restart: restarted,
    });
  }

  /** Refresh when due (or forced). Concurrent callers share one attempt. */
  function refreshNow({ reason = "manual", force = false } = {}) {
    if (inFlight) return inFlight;
    inFlight = perform({ reason, force })
      .then((result) => { lastOutcome = result; return result; })
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  /**
   * A runner reported an OAuth 401. Rotate the grant if it is stale; either
   * way restart idle runners so they pick up whatever is on disk.
   */
  async function recover({ reason = "runner_401" } = {}) {
    const result = await refreshNow({ reason });
    if (result.outcome === "refreshed") return result;
    if (result.outcome === "not_needed") {
      return Object.freeze({ ...result, restart: await restart(reason) });
    }
    return result;
  }

  function tick() {
    refreshNow({ reason: "scheduled" }).catch((error) => {
      logger.error(`[oyster] Claude Code OAuth upkeep failed: ${errorMessage(error)}`);
    });
  }

  function start() {
    if (timer !== null) return timer;
    const schedule = () => {
      timer = setTimer(() => { tick(); if (timer !== null) schedule(); }, intervalMs);
      timer?.unref?.();
    };
    schedule();
    return timer;
  }

  function stop() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  return Object.freeze({
    start, stop, refreshNow, recover,
    get running() { return timer !== null; },
    get lastOutcome() { return lastOutcome; },
  });
}
