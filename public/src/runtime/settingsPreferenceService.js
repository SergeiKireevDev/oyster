export const THINKING_VISIBILITY_KEY = "pi_show_thinking";
export const THEME_KEY = "pi_theme";
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
}) {
  const applyTheme = (theme) => {
    rootElement?.setAttribute?.("data-theme", theme);
    themeColorElement?.setAttribute?.("content", THEME_COLORS[theme]);
    return theme;
  };

  applyTheme(readTheme(storage));

  return Object.freeze({
    isThinkingVisible() {
      return storage.getItem(THINKING_VISIBILITY_KEY) !== "0";
    },
    setThinkingVisible(visible) {
      storage.setItem(THINKING_VISIBILITY_KEY, visible ? "1" : "0");
      return onThinkingVisibilityChanged(visible);
    },
    isLightMode() {
      return readTheme(storage) === LIGHT_THEME;
    },
    setLightMode(enabled) {
      const theme = enabled ? LIGHT_THEME : DARK_THEME;
      storage.setItem(THEME_KEY, theme);
      applyTheme(theme);
      onThemeChanged(theme);
      return theme;
    },
  });
}
