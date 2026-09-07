const NATIVE_HARNESSES = new Set(["claude-code", "codex", "gemini", "amp"]);

/** Check newly created native sessions without forcing existing users to sign in again. */
export function createNewHarnessAuthenticationCheck({ rpc, getCurrentRunner, openCredentials, toast }) {
  return async (runner) => {
    if (!runner?.id || !NATIVE_HARNESSES.has(runner.harness) || getCurrentRunner() !== runner.id) return;
    try {
      const { models = [] } = await rpc({ type: "get_available_models" });
      if (getCurrentRunner() !== runner.id || models.length) return;
      await openCredentials({ harness: runner.harness });
    } catch (error) {
      if (getCurrentRunner() === runner.id) toast(`Could not check ${runner.harness} authentication: ${error.message}`, "error");
    }
  };
}
