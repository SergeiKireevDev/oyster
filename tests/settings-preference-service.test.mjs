import test from "node:test";
import assert from "node:assert/strict";
import {
  createSettingsPreferenceService,
  DARK_THEME,
  LIGHT_THEME,
  NEW_SESSION_HARNESS_KEY,
  THEME_COLORS,
  THEME_KEY,
  THINKING_VISIBILITY_KEY,
  WEB_PUSH_KEY,
} from "../public/src/runtime/settingsPreferenceService.js";

test("settings preference service defaults thinking visibility on and reads persisted values", () => {
  const values = new Map();
  const service = createSettingsPreferenceService({
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
  });

  assert.equal(service.isThinkingVisible(), true);
  values.set(THINKING_VISIBILITY_KEY, "0");
  assert.equal(service.isThinkingVisible(), false);
  values.set(THINKING_VISIBILITY_KEY, "1");
  assert.equal(service.isThinkingVisible(), true);
});

test("settings preference service remembers the new-session harness", () => {
  const values = new Map();
  const service = createSettingsPreferenceService({
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
  });
  assert.equal(service.getNewSessionHarness(), "");
  assert.equal(service.setNewSessionHarness("claude-code"), "claude-code");
  assert.equal(values.get(NEW_SESSION_HARNESS_KEY), "claude-code");
  assert.equal(service.getNewSessionHarness(), "claude-code");
});

test("settings preference service persists thinking visibility and refreshes the runtime", () => {
  const calls = [];
  const values = new Map();
  const service = createSettingsPreferenceService({
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); calls.push(["persist", key, value]); },
    },
    onThinkingVisibilityChanged: (visible) => calls.push(["refresh", visible]),
  });

  service.setThinkingVisible(false);
  service.setThinkingVisible(true);

  assert.deepEqual(calls, [
    ["persist", THINKING_VISIBILITY_KEY, "0"],
    ["refresh", false],
    ["persist", THINKING_VISIBILITY_KEY, "1"],
    ["refresh", true],
  ]);
  assert.equal(service.isThinkingVisible(), true);
});

test("settings preference service applies and persists the selected color theme", () => {
  const values = new Map([[THEME_KEY, LIGHT_THEME]]);
  const attributes = new Map();
  const metaAttributes = new Map();
  const changed = [];
  const service = createSettingsPreferenceService({
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    rootElement: { setAttribute: (key, value) => attributes.set(key, value) },
    themeColorElement: { setAttribute: (key, value) => metaAttributes.set(key, value) },
    onThemeChanged: (theme) => changed.push(theme),
  });

  assert.equal(service.isLightMode(), true);
  assert.equal(attributes.get("data-theme"), LIGHT_THEME);
  assert.equal(metaAttributes.get("content"), THEME_COLORS[LIGHT_THEME]);

  assert.equal(service.setLightMode(false), DARK_THEME);
  assert.equal(values.get(THEME_KEY), DARK_THEME);
  assert.equal(service.isLightMode(), false);
  assert.equal(attributes.get("data-theme"), DARK_THEME);
  assert.equal(metaAttributes.get("content"), THEME_COLORS[DARK_THEME]);
  assert.deepEqual(changed, [DARK_THEME]);
});

test("settings preference service opts a device into and out of authenticated Web Push", async (t) => {
  const originalNotification = globalThis.Notification;
  const originalPushManager = globalThis.PushManager;
  t.after(() => { globalThis.Notification = originalNotification; globalThis.PushManager = originalPushManager; });
  globalThis.Notification = { requestPermission: async () => "granted" };
  globalThis.PushManager = function PushManager() {};
  const values = new Map();
  const requests = [];
  let subscription = null;
  const pushSubscription = {
    endpoint: "https://push.example/subscription",
    keys: { p256dh: "key", auth: "auth" },
    toJSON() { return { endpoint: this.endpoint, keys: this.keys }; },
    async unsubscribe() { subscription = null; return true; },
  };
  const registration = { pushManager: {
    async getSubscription() { return subscription; },
    async subscribe() { subscription = pushSubscription; return subscription; },
  } };
  const service = createSettingsPreferenceService({
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    navigatorTarget: { serviceWorker: { ready: Promise.resolve(registration) } },
    fetchImpl: async (url, options = {}) => {
      requests.push([url, options.method ?? "GET"]);
      return { ok: true, json: async () => ({ publicKey: "AQ" }) };
    },
  });

  assert.equal(service.isWebPushSupported(), true);
  assert.equal(await service.setWebPushEnabled(true), true);
  assert.equal(values.get(WEB_PUSH_KEY), "1");
  assert.equal(await service.setWebPushEnabled(false), false);
  assert.equal(values.get(WEB_PUSH_KEY), "0");
  assert.deepEqual(requests, [["/push/config", "GET"], ["/push/subscription", "POST"], ["/push/subscription", "DELETE"]]);
});

test("settings preference service defaults invalid theme values to dark", () => {
  const values = new Map([[THEME_KEY, "system"]]);
  let applied;
  const service = createSettingsPreferenceService({
    storage: { getItem: (key) => values.get(key) ?? null, setItem: () => {} },
    rootElement: { setAttribute: (_key, value) => { applied = value; } },
  });

  assert.equal(service.isLightMode(), false);
  assert.equal(applied, DARK_THEME);
});
