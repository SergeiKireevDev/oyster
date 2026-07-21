function providerName(provider) {
  return provider?.displayName || provider?.provider || "provider";
}

export function createCredentialsController({ fetchImpl, confirm, toast, setState } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (typeof confirm !== "function") throw new TypeError("confirm is required");
  if (typeof setState !== "function") throw new TypeError("setState is required");
  const notify = typeof toast === "function" ? toast : () => {};
  let providers = [];
  let activeRequest = null;
  let tornDown = false;

  function beginRequest() {
    activeRequest?.abort();
    activeRequest = new AbortController();
    return activeRequest;
  }

  async function jsonRequest(path, options = {}) {
    const request = beginRequest();
    const response = await fetchImpl(path, { ...options, signal: request.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `credential request failed (${response.status})`);
      error.status = response.status;
      error.code = data.code;
      error.details = data;
      throw error;
    }
    return data;
  }

  function publish(patch) {
    if (!tornDown) setState(patch);
  }

  async function load({ quiet = false } = {}) {
    if (tornDown) return [];
    if (!quiet) publish({ loading: true, error: "" });
    try {
      const data = await jsonRequest("/api-keys");
      providers = Array.isArray(data.providers) ? data.providers : [];
      publish({ providers, loading: false, error: "" });
      return providers;
    } catch (error) {
      if (error.name === "AbortError" || tornDown) return providers;
      publish({ loading: false, error: error.message });
      if (!quiet) notify("Could not load API key status", "error");
      return providers;
    }
  }

  async function save({ provider, key } = {}) {
    if (tornDown) return { ok: false };
    const row = providers.find((item) => item.provider === provider);
    const name = providerName(row ?? { provider });
    const replacing = row?.credentialType === "api_key";
    const accepted = await confirm(
      replacing ? `Replace API key for ${name}?` : `Save API key for ${name}?`,
      `${replacing ? "Replace the stored key" : "Save this key"} and restart every active pi process?`,
    );
    if (!accepted || tornDown) return { ok: false, cancelled: true };

    publish({ loading: true, error: "" });
    try {
      const data = await jsonRequest("/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, key, restart: true }),
      });
      publish({ loading: false, error: "", lastRestart: data.restart ?? null });
      notify(data.restart?.status === "restarted" ? "API key saved; pi restarted" : "API key saved; check pi restart status");
      await load({ quiet: true });
      return { ok: true, restart: data.restart ?? null };
    } catch (error) {
      if (error.name === "AbortError" || tornDown) return { ok: false };
      const partial = error.details?.credential;
      publish({ loading: false, error: error.message, lastRestart: error.details?.restart ?? null });
      notify(partial ? "API key saved, but pi restart was incomplete" : "API key was not saved", "error");
      if (partial) await load({ quiet: true });
      return { ok: false, saved: Boolean(partial), restart: error.details?.restart ?? null };
    }
  }

  async function remove(provider) {
    if (tornDown) return { ok: false };
    const row = providers.find((item) => item.provider === provider);
    const name = providerName(row ?? { provider });
    const accepted = await confirm(
      `Remove API key for ${name}?`,
      "Remove it from pi and restart every active pi process? This does not revoke the key at the provider.",
    );
    if (!accepted || tornDown) return { ok: false, cancelled: true };

    publish({ loading: true, error: "" });
    try {
      const data = await jsonRequest("/api-keys", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, restart: true }),
      });
      publish({ loading: false, error: "", lastRestart: data.restart ?? null });
      notify(data.restart?.status === "restarted" ? "API key removed from pi; pi restarted" : "API key removed; check pi restart status");
      const refreshed = await load({ quiet: true });
      const fallback = refreshed.find((item) => item.provider === provider)?.source;
      if (fallback && fallback !== "not_configured") notify(`pi may still authenticate ${name} using ${fallback === "models_json" ? "models.json" : fallback}`);
      return { ok: true, restart: data.restart ?? null };
    } catch (error) {
      if (error.name === "AbortError" || tornDown) return { ok: false };
      const partial = error.details?.credential;
      publish({ loading: false, error: error.message, lastRestart: error.details?.restart ?? null });
      notify(partial ? "API key removed, but pi restart was incomplete" : "API key was not removed", "error");
      if (partial) await load({ quiet: true });
      return { ok: false, removed: Boolean(partial), restart: error.details?.restart ?? null };
    }
  }

  function teardown() {
    if (tornDown) return;
    tornDown = true;
    activeRequest?.abort();
    activeRequest = null;
    providers = [];
    setState({ providers: [], loading: false, error: "", lastRestart: null });
  }

  return Object.freeze({ load, save, remove, teardown });
}
