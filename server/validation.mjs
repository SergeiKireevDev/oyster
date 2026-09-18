/** Assert an injected callback without changing assertion-only callers' return contract. */
export function assertFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
}

/** Validate and return an injected callback. */
export function requireFunction(value, name) {
  assertFunction(value, name);
  return value;
}

/** Reject whitespace-only strings but preserve the caller's original value. */
export function requireNonBlankString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

/** Validate a nonblank string and normalize surrounding whitespace. */
export function requireTrimmedNonEmptyString(value, name) {
  return requireNonBlankString(value, name).trim();
}
