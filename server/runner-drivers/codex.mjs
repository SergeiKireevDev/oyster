import { createHeadlessDriver } from "./headless-driver.mjs";
export { discoverCodexModels } from "./native-models.mjs";

/** OpenAI Codex CLI adapter using `codex exec --json` turns behind a durable bridge. */
export function createCodexDriver(options = {}) {
  return createHeadlessDriver({
    id: "codex", label: "Codex", kind: "codex", provider: "openai",
    sandbox: "workspace-write",
    ...options,
  });
}
