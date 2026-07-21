const ROUTE_KEY = /^[A-Z]+ \/\S*$/;

function routeEntries(name, routes) {
  if (routes instanceof Map) return routes.entries();
  if (routes && typeof routes === "object" && !Array.isArray(routes)) {
    return Object.entries(routes);
  }
  throw new TypeError(`route group "${name}" must be an object or Map`);
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
  if (!groups || typeof groups !== "object" || Array.isArray(groups)) {
    throw new TypeError("route groups must be a named object");
  }

  const table = new Map();
  const owners = new Map();
  for (const [name, routes] of Object.entries(groups)) {
    for (const [key, handler] of routeEntries(name, routes)) {
      if (!ROUTE_KEY.test(key)) {
        throw new TypeError(`invalid route key "${key}" in group "${name}"`);
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
