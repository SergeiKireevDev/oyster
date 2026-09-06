/**
 * oyster — Anthropic OAuth token upkeep
 *
 * pi and Claude Code share one Anthropic grant. Headless Claude Code runners
 * load `.credentials.json` once and only refresh the grant themselves within
 * five minutes of expiry; a runner that idles across that window sends its
 * stale token, receives a non-retryable 401, and dies. Oyster therefore owns
 * the lifecycle: the credential service rotates the grant well before either
 * harness's own window (so the single-use refresh token is never contended)
 * and mirrors it to both stores; this service drives that on a timer, then
 * restarts idle Claude Code runners so they reload the file. A runner that
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
  rotate,
  restartRunners,
  marginMs = DEFAULT_MARGIN_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  logger = console,
  providerLabel = "Anthropic",
  runnerLabel = "Claude Code",
} = {}) {
  requireFunction(rotate, "rotate");
  requireFunction(restartRunners, "restartRunners");
  requirePositive(marginMs, "refresh margin");
  requirePositive(intervalMs, "refresh check interval");
  requireFunction(setTimer, "timer scheduler");
  requireFunction(clearTimer, "timer clearer");
  requireFunction(logger?.log, "logger.log");
  requireFunction(logger?.warn, "logger.warn");
  requireFunction(logger?.error, "logger.error");

  let timer = null;
  let inFlight = null;
  let lastOutcome = null;
  let reauthLogged = false;

  async function restart(reason) {
    try {
      return await restartRunners({ reason });
    } catch (error) {
      logger.error(`[oyster] ${runnerLabel} runner restart after OAuth ${reason} failed: ${errorMessage(error)}`);
      return null;
    }
  }

  async function perform({ reason, force }) {
    let result;
    try {
      result = await rotate({ reason, force, marginMs });
    } catch (error) {
      logger.warn(`[oyster] ${providerLabel} OAuth upkeep could not run (${reason}); will retry: ${errorMessage(error)}`);
      return Object.freeze({ outcome: "failed", reason, error: errorMessage(error) });
    }
    if (result?.outcome === "reauth_required") {
      if (!reauthLogged) logger.error(`[oyster] ${providerLabel} OAuth refresh rejected (${reason}); re-authenticate from the Credentials modal`);
      reauthLogged = true;
      return result;
    }
    reauthLogged = false;
    if (result?.outcome === "failed") {
      logger.warn(`[oyster] ${providerLabel} OAuth refresh failed (${reason}); will retry: ${result.error ?? "unknown error"}`);
      return result;
    }
    if (result?.outcome !== "refreshed") return result;
    logger.log(`[oyster] ${providerLabel} OAuth token ${result.rotated ? "rotated" : "adopted from a concurrent update"} (${reason}); `
      + `access expires ${isoOrNull(result.expiresAt)}, refresh token expires ${isoOrNull(result.refreshTokenExpiresAt) ?? "unknown"}`);
    return Object.freeze({ ...result, restart: await restart(reason) });
  }

  /** Rotate when due (or forced). Concurrent callers share one attempt. */
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
    if (result.outcome === "not_needed") return Object.freeze({ ...result, restart: await restart(reason) });
    return result;
  }

  function tick() {
    refreshNow({ reason: "scheduled" }).catch((error) => {
      logger.error(`[oyster] ${providerLabel} OAuth upkeep failed: ${errorMessage(error)}`);
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
