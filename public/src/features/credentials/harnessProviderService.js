/** Credential values live only in the POST body, never in returned metadata. */
export function createHarnessProviderService({ fetchImpl = (...args) => fetch(...args) } = {}) {
  return {
    async load() {
      const response = await fetchImpl("/harness-providers");
      if (!response.ok) throw new Error("Could not load harness provider settings");
      return response.json();
    },
    async select(harness, provider, key) {
      if (provider === "openrouter" && key.trim()) {
        const saved = await fetchImpl("/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "openrouter", key, restart: true }) });
        if (!saved.ok) throw new Error("Key save or runner restart failed; refresh credentials before retrying");
      }
      const response = await fetchImpl("/harness-providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ harness, provider, confirm: true }) });
      if (!response.ok) throw new Error("Provider change or restart failed. Check the saved key and refresh settings.");
    },
  };
}
