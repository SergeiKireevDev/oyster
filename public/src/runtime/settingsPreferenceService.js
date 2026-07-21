export const THINKING_VISIBILITY_KEY = "pi_show_thinking";

/** Creates mount-scoped access to persisted UI preferences. */
export function createSettingsPreferenceService({ storage, onThinkingVisibilityChanged = () => {} }) {
  return Object.freeze({
    isThinkingVisible() {
      return storage.getItem(THINKING_VISIBILITY_KEY) !== "0";
    },
    setThinkingVisible(visible) {
      storage.setItem(THINKING_VISIBILITY_KEY, visible ? "1" : "0");
      return onThinkingVisibilityChanged(visible);
    },
  });
}
