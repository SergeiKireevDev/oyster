/** Logging must not change a completed or reconciliation lifecycle operation. */
export function logError(logger, message) {
  try { logger.error(message); } catch {}
}
