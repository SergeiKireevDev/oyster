// Request dispatch looks routes up with `${req.method} ${url.pathname}`. Query,
// fragment, control, and backslash characters therefore cannot form a stable
// pathname key (the WHATWG URL parser splits or normalizes them).
const ROUTE_KEY = /^[A-Z]+ \/[^\s\x00-\x1f\x7f?#\\]*$/u;

function isRecord(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function routeEntries(name, routes) {
  if (routes instanceof Map) return routes.entries();
  if (isRecord(routes)) return Object.entries(routes);
  throw new TypeError(`route group "${name}" must be a plain object or Map`);
}

/**
 * Merge named route maps into one method/path lookup table.
 *
 * Groups and routes retain their insertion order. Duplicate keys are rejected
 * so a bad hot-reloaded composition cannot silently shadow an active route.
 *
 * @param {Record<string, Record<string, Function> | Map<string, Function>>} groups
 * @returns {Map<string, Function>}
 */
export function createRouteTable(groups) {
  if (!isRecord(groups)) {
    throw new TypeError("route groups must be a named plain object");
  }

  const table = new Map();
  const owners = new Map();
  for (const [name, routes] of Object.entries(groups)) {
    for (const [key, handler] of routeEntries(name, routes)) {
      if (typeof key !== "string") {
        throw new TypeError(`route key in group "${name}" must be a string`);
      }
      if (!ROUTE_KEY.test(key)) {
        throw new TypeError(`invalid route key ${JSON.stringify(key)} in group "${name}"`);
      }
      if (typeof handler !== "function") {
        throw new TypeError(`handler for "${key}" in group "${name}" must be a function`);
      }
      if (table.has(key)) {
        throw new Error(`duplicate route "${key}" in groups "${owners.get(key)}" and "${name}"`);
      }
      table.set(key, handler);
      owners.set(key, name);
    }
  }
  return table;
}
