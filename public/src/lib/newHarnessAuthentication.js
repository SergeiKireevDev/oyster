const HARNESSES = new Set(["pi", "claude-code", "codex", "gemini", "amp"]);

export function hasAuthenticatedProvider(providers, harness) {
  return providers.some((provider) => {
    if (provider.configured !== true) return false;
    if ((provider.harness ?? "pi") === harness) return true;
    // Shared native connections require an OAuth grant, not Pi's API-key/environment fallback.
    return provider.harnesses?.includes(harness) && provider.credentialType === "oauth";
  });
}

/** Check credential metadata, without starting model discovery or a login flow. */
export function createNewHarnessAuthenticationCheck({ fetchImpl, getCurrentRunner, openCredentials, toast }) {
  return async (runner) => {
    if (!runner?.id || !HARNESSES.has(runner.harness) || getCurrentRunner() !== runner.id) return;
    try {
      const response = await fetchImpl("/api-keys");
      if (!response.ok) throw new Error(`credential status request failed (${response.status})`);
      const { providers } = await response.json();
      if (!Array.isArray(providers)) throw new Error("invalid credential status response");
      if (getCurrentRunner() !== runner.id || hasAuthenticatedProvider(providers, runner.harness)) return;
      await openCredentials({ harness: runner.harness });
    } catch (error) {
      if (getCurrentRunner() === runner.id) toast(`Could not check ${runner.harness} authentication: ${error.message}`, "error");
    }
  };
}
