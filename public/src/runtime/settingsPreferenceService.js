export const THINKING_VISIBILITY_KEY = "pi_show_thinking";
export const THEME_KEY = "pi_theme";
export const WEB_PUSH_KEY = "pi_web_push";
export const NEW_SESSION_HARNESS_KEY = "oyster_new_session_harness";
export const DARK_THEME = "dark";
export const LIGHT_THEME = "light";
export const THEME_COLORS = Object.freeze({
  [DARK_THEME]: "#0b0d12",
  [LIGHT_THEME]: "#f5f7fb",
});

function readTheme(storage) {
  return storage.getItem(THEME_KEY) === LIGHT_THEME ? LIGHT_THEME : DARK_THEME;
}

/** Creates mount-scoped access to persisted, device-local UI preferences. */
export function createSettingsPreferenceService({
  storage,
  rootElement,
  themeColorElement,
  onThinkingVisibilityChanged = () => {},
  onThemeChanged = () => {},
  navigatorTarget = globalThis.navigator,
  fetchImpl = (...args) => globalThis.fetch(...args),
}) {
  let disposed = false;
  let notifyThinkingVisibilityChanged = onThinkingVisibilityChanged;
  let notifyThemeChanged = onThemeChanged;

  const applyTheme = (theme) => {
    rootElement?.setAttribute?.("data-theme", theme);
    themeColorElement?.setAttribute?.("content", THEME_COLORS[theme]);
    return theme;
  };

  applyTheme(readTheme(storage));

  const decodeVapidKey = (value) => {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
  };
  const pushSupported = () => !!(navigatorTarget?.serviceWorker && globalThis.PushManager && globalThis.Notification);

  async function setWebPushEnabled(enabled) {
    if (disposed) return false;
    if (!pushSupported()) throw new Error("Web Push is not supported in this browser");
    // Mobile Safari requires the permission prompt to happen in the original
    // checkbox gesture. Do not place an await before requestPermission().
    const permissionRequest = enabled ? Notification.requestPermission() : null;
    const registration = await navigatorTarget.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (!enabled) {
      if (existing) {
        await fetchImpl("/push/subscription", {
          method: "DELETE", headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        }).catch(() => {});
        await existing.unsubscribe();
      }
      storage.setItem(WEB_PUSH_KEY, "0");
      return false;
    }
    const permission = await permissionRequest;
    if (permission !== "granted") throw new Error("Notification permission was not granted");
    let subscription = existing;
    if (!subscription) {
      const response = await fetchImpl("/push/config");
      if (!response.ok) throw new Error(`Cannot load push configuration (${response.status})`);
      const { publicKey } = await response.json();
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(publicKey) });
    }
    const saved = await fetchImpl("/push/subscription", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(subscription),
    });
    if (!saved.ok) {
      if (!existing) await subscription.unsubscribe().catch(() => {});
      throw new Error(`Cannot save push subscription (${saved.status})`);
    }
    storage.setItem(WEB_PUSH_KEY, "1");
    return true;
  }

  return Object.freeze({
    getNewSessionHarness() {
      return storage.getItem(NEW_SESSION_HARNESS_KEY) ?? "";
    },
    setNewSessionHarness(harness) {
      if (disposed) return undefined;
      storage.setItem(NEW_SESSION_HARNESS_KEY, harness);
      return harness;
    },
    isThinkingVisible() {
      return storage.getItem(THINKING_VISIBILITY_KEY) !== "0";
    },
    setThinkingVisible(visible) {
      if (disposed) return undefined;
      storage.setItem(THINKING_VISIBILITY_KEY, visible ? "1" : "0");
      return notifyThinkingVisibilityChanged(visible);
    },
    isWebPushSupported: pushSupported,
    isWebPushEnabled() { return storage.getItem(WEB_PUSH_KEY) === "1"; },
    setWebPushEnabled,
    isLightMode() {
      return readTheme(storage) === LIGHT_THEME;
    },
    setLightMode(enabled) {
      if (disposed) return readTheme(storage);
      const theme = enabled ? LIGHT_THEME : DARK_THEME;
      storage.setItem(THEME_KEY, theme);
      applyTheme(theme);
      notifyThemeChanged(theme);
      return theme;
    },
    teardown() {
      if (disposed) return;
      disposed = true;
      notifyThinkingVisibilityChanged = () => {};
      notifyThemeChanged = () => {};
    },
  });
}
