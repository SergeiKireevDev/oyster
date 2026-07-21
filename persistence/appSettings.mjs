import { isAbsolute, resolve } from "node:path";

export const APP_SETTING_KEYS = Object.freeze({
  currentWorkdir: "current_workdir",
  defaultRunnerId: "default_runner_id",
});

function decodeJson(row, key) {
  if (!row) return undefined;
  try { return JSON.parse(row.value); }
  catch { throw new Error(`invalid JSON for app setting ${key}`); }
}

function validateWorkdir(value) {
  if (typeof value !== "string" || !value.trim() || !isAbsolute(value)) throw new Error("current workdir must be an absolute path");
  return resolve(value);
}

function validateRunnerId(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^r-[a-zA-Z0-9_-]{8,128}$/.test(value)) throw new Error("default runner ID is invalid");
  return value;
}

/** Typed mutable server settings. Persisted valid values override startup defaults. */
export function createAppSettings({ repository, startupWorkdir, now = () => new Date().toISOString() } = {}) {
  if (!repository?.get || !repository?.set) throw new Error("settings repository is required");
  const startup = validateWorkdir(startupWorkdir);
  const read = (key, validate, fallback) => {
    try {
      const value = decodeJson(repository.get(key), key);
      return value === undefined ? fallback : validate(value);
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    repository.set(key, JSON.stringify(value), now());
    return value;
  };
  return Object.freeze({
    hydrate() {
      return Object.freeze({
        currentWorkdir: read(APP_SETTING_KEYS.currentWorkdir, validateWorkdir, startup),
        defaultRunnerId: read(APP_SETTING_KEYS.defaultRunnerId, validateRunnerId, null),
      });
    },
    setCurrentWorkdir(value) { return write(APP_SETTING_KEYS.currentWorkdir, validateWorkdir(value)); },
    setDefaultRunnerId(value) { return write(APP_SETTING_KEYS.defaultRunnerId, validateRunnerId(value)); },
  });
}
