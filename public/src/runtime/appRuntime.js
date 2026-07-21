/**
 * Temporary composition root for the browser application. Feature and
 * transport ownership will move here incrementally while preserving the
 * existing startup behavior.
 */
export async function startAppRuntime() {
  const { startLegacyRuntime } = await import("../legacy.js");
  startLegacyRuntime();
}
