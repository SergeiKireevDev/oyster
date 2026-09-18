/** Structural object check; intentionally accepts Date and class instances. */
export function isNonArrayObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Preserve the OAuth body predicate's falsy passthrough contract. */
export function objectBody(body) {
  return body && isNonArrayObject(body);
}
