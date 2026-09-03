export const REQUIRED_RUNNER_DRIVER_METHODS = Object.freeze([
  "isSessionCompatible",
  "launch",
  "decodeLine",
  "sendCommand",
  "stateCommand",
  "startup",
  "sessionReference",
]);

/** Validate the process/protocol adapter consumed by the runner manager. */
export function validateRunnerDriver(driver) {
  if (!driver || typeof driver !== "object") throw new TypeError("runner driver is required");
  if (typeof driver.id !== "string" || !driver.id.trim()) throw new TypeError("runner driver id is required");
  for (const method of REQUIRED_RUNNER_DRIVER_METHODS) {
    if (typeof driver[method] !== "function") throw new TypeError(`runner driver requires ${method}()`);
  }
  return driver;
}
