import { createHeadlessDriver } from "./headless-driver.mjs";
export { discoverGeminiModels } from "./native-models.mjs";

/** Google Gemini CLI adapter using headless stream-JSON turns behind a durable bridge. */
export function createGeminiDriver(options = {}) {
  return createHeadlessDriver({
    id: "gemini", label: "Gemini CLI", kind: "gemini", provider: "google",
    approvalMode: "auto_edit", generateSessionId: true,
    ...options,
  });
}
