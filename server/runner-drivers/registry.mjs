import { validateRunnerDriver } from "./contract.mjs";

function requireId(value, name) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new TypeError(`${name} must be a non-empty trimmed string`);
  }
  return value;
}

/** Immutable registry used to select a process/protocol driver per runner. */
export function createRunnerDriverRegistry({ drivers, defaultId = "pi" } = {}) {
  if (!Array.isArray(drivers) || !drivers.length) throw new TypeError("runner drivers must be a non-empty array");
  const byId = new Map();
  for (const candidate of drivers) {
    const driver = validateRunnerDriver(candidate);
    if (byId.has(driver.id)) throw new Error(`duplicate runner driver: ${driver.id}`);
    byId.set(driver.id, driver);
  }
  const selectedDefault = requireId(defaultId, "default runner driver id");
  if (!byId.has(selectedDefault)) throw new Error(`default runner driver is unavailable: ${selectedDefault}`);

  function get(id = selectedDefault) {
    const key = requireId(id, "runner harness");
    const driver = byId.get(key);
    if (!driver) throw new Error(`runner harness is unavailable: ${key}`);
    return driver;
  }

  function compatible(reference, preferredId = null) {
    if (preferredId) {
      const preferred = byId.get(preferredId);
      if (preferred?.isSessionCompatible(reference)) return preferred;
    }
    return [...byId.values()].find((driver) => driver.isSessionCompatible(reference)) ?? null;
  }

  return Object.freeze({
    defaultId: selectedDefault,
    get,
    has: (id) => typeof id === "string" && byId.has(id),
    compatible,
    list: () => [...byId.values()].map((driver) => Object.freeze({
      id: driver.id,
      label: driver.label ?? driver.id,
    })),
  });
}

export function validateRunnerDriverRegistry(registry) {
  if (!registry || typeof registry !== "object") throw new TypeError("runner driver registry is required");
  if (typeof registry.defaultId !== "string" || !registry.defaultId) throw new TypeError("runner driver registry defaultId is required");
  for (const method of ["get", "has", "compatible", "list"]) {
    if (typeof registry[method] !== "function") throw new TypeError(`runner driver registry requires ${method}()`);
  }
  registry.get(registry.defaultId);
  return registry;
}
