import { isAbsolute, resolve } from "node:path";

export const APP_SETTING_KEYS = Object.freeze({
  currentWorkdir: "current_workdir",
  defaultRunnerId: "default_runner_id",
});

/** Deliberate migration policy: device-specific, non-secret UI choices stay browser-local. */
const SENSITIVE_SETTING_KEY = /(^|_)(token|secret|password|credential|bearer|oauth|api_?key|private_?key|access_?token|refresh_?token|authorization_?code|device_?code|redirect_?url|flow_?(?:id|snapshot)|prompt_?response)s?($|_)/i;

function normalizeSettingKey(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase();
}

export function assertGeneralAppSettingKey(key) {
  if (typeof key !== "string" || !key.trim()) throw new Error("app setting key is required");
  if (SENSITIVE_SETTING_KEY.test(normalizeSettingKey(key))) {
    throw new Error(`sensitive value ${key} is forbidden in general app settings`);
  }
  return key;
}

export function assertGeneralAppSettingValue(value) {
  if (typeof value !== "string") throw new Error("app setting value must be serialized JSON");
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw new Error("app setting value must be valid serialized JSON", { cause });
  }

  // Use an explicit stack so a valid, deeply nested payload cannot overflow the
  // call stack while enforcing the credential boundary.
  const pending = [parsed];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry || typeof entry !== "object") continue;
    if (Array.isArray(entry)) {
      for (const child of entry) pending.push(child);
      continue;
    }
    for (const [key, child] of Object.entries(entry)) {
      assertGeneralAppSettingKey(key);
      pending.push(child);
    }
  }
  return value;
}

export const BROWSER_PREFERENCE_SYNC_POLICY = Object.freeze({
  syncToSqlite: false,
  storage: "browser-localStorage",
  keys: Object.freeze(["pi_show_thinking", "pi_theme", "pi_carousel", "pi_ckpt_model", "pi_runner"]),
  rationale: "These choices are device-specific and do not affect server resource ownership or recovery.",
});

function decodeJson(row, key) {
  if (!row) return undefined;
  try { return JSON.parse(row.value); }
  catch { throw new Error(`invalid JSON for app setting ${key}`); }
}

const MAX_PATH_BYTES = 16 * 1024;

function validateWorkdir(value) {
  if (typeof value !== "string" || !value.trim() || !isAbsolute(value)) {
    throw new Error("current workdir must be an absolute path");
  }
  if (value.includes("\0") || Buffer.byteLength(value) > MAX_PATH_BYTES) {
    throw new Error("current workdir must not contain null bytes or exceed 16 KiB");
  }
  return resolve(value);
}

function validateRunnerId(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^r-[a-zA-Z0-9_-]{8,128}$/.test(value)) throw new Error("default runner ID is invalid");
  return value;
}

/** Typed mutable server settings. Persisted valid values override startup defaults. */
export function createAppSettings({ repository, startupWorkdir, now = () => new Date().toISOString() } = {}) {
  if (typeof repository?.get !== "function" || typeof repository?.set !== "function") {
    throw new Error("settings repository is required");
  }
  if (typeof now !== "function") throw new TypeError("now must be a function");
  const startup = validateWorkdir(startupWorkdir);
  const read = async (key, validate, fallback) => {
    // Repository failures indicate unavailable persistence and must not be
    // confused with a single corrupt value, which can safely use its default.
    const row = await repository.get(key);
    try {
      const value = decodeJson(row, key);
      return value === undefined ? fallback : validate(value);
    } catch {
      return fallback;
    }
  };
  const write = async (key, value) => {
    await repository.set(key, JSON.stringify(value), now());
    return value;
  };
  return Object.freeze({
    async hydrate() {
      const [currentWorkdir, defaultRunnerId] = await Promise.all([
        read(APP_SETTING_KEYS.currentWorkdir, validateWorkdir, startup),
        read(APP_SETTING_KEYS.defaultRunnerId, validateRunnerId, null),
      ]);
      return Object.freeze({ currentWorkdir, defaultRunnerId });
    },
    setCurrentWorkdir(value) { return write(APP_SETTING_KEYS.currentWorkdir, validateWorkdir(value)); },
    setDefaultRunnerId(value) { return write(APP_SETTING_KEYS.defaultRunnerId, validateRunnerId(value)); },
  });
}
