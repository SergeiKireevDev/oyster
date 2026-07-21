import { isAbsolute, resolve } from "node:path";

export const APP_SETTING_KEYS = Object.freeze({
  currentWorkdir: "current_workdir",
  defaultRunnerId: "default_runner_id",
});

/** Deliberate migration policy: device-specific, non-secret UI choices stay browser-local. */
const SENSITIVE_SETTING_KEY = /(^|[_-])(token|secret|password|credential|bearer|api[_-]?key|private[_-]?key)s?($|[_-])/i;

export function assertGeneralAppSettingKey(key) {
  if (typeof key !== "string" || !key.trim()) throw new Error("app setting key is required");
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  if (SENSITIVE_SETTING_KEY.test(normalized)) throw new Error(`sensitive value ${key} is forbidden in general app settings`);
  return key;
}

export function assertGeneralAppSettingValue(value) {
  if (typeof value !== "string") throw new Error("app setting value must be serialized JSON");
  let parsed;
  try { parsed = JSON.parse(value); } catch { return value; }
  const visit = (entry) => {
    if (!entry || typeof entry !== "object") return;
    if (Array.isArray(entry)) { entry.forEach(visit); return; }
    for (const [key, child] of Object.entries(entry)) {
      assertGeneralAppSettingKey(key);
      visit(child);
    }
  };
  visit(parsed);
  return value;
}

export const BROWSER_PREFERENCE_SYNC_POLICY = Object.freeze({
  syncToSqlite: false,
  storage: "browser-localStorage",
  keys: Object.freeze(["pi_show_thinking", "pi_carousel", "pi_ckpt_model", "pi_runner"]),
  rationale: "These choices are device-specific and do not affect server resource ownership or recovery.",
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
