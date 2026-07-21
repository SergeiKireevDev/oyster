function providerName(provider) {
  return provider?.displayName || provider?.provider || "provider";
}

export function createCredentialsController({
  fetchImpl,
  confirm,
  toast,
  setState,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (typeof confirm !== "function") throw new TypeError("confirm is required");
  if (typeof setState !== "function") throw new TypeError("setState is required");
  const notify = typeof toast === "function" ? toast : () => {};
  let providers = [];
  let flow = null;
  let activeRequest = null;
  let pollTimer = null;
  let pollDelay = 500;
  let visible = false;
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

  const jsonPost = (path, body) => jsonRequest(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  function publish(patch) {
    if (!tornDown) setState(patch);
  }

  function stopPolling() {
    if (pollTimer !== null) clearTimer(pollTimer);
    pollTimer = null;
  }

  function schedulePoll() {
    stopPolling();
    if (!visible || tornDown || flow?.status !== "pending") return;
    const delay = pollDelay;
    pollDelay = Math.min(Math.round(pollDelay * 1.5), 3000);
    pollTimer = setTimer(() => {
      pollTimer = null;
      void poll();
    }, delay);
    pollTimer?.unref?.();
  }

  function applyFlow(next) {
    flow = next ?? null;
    publish({ flow, error: "" });
    if (flow?.status === "pending") {
      schedulePoll();
      return;
    }
    stopPolling();
    if (flow?.restart) publish({ lastRestart: flow.restart });
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
      if (!quiet) notify("Could not load credential status", "error");
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

  async function startOAuth(provider) {
    if (tornDown) return { ok: false };
    const row = providers.find((item) => item.provider === provider);
    const name = providerName(row ?? { provider });
    const replacing = Boolean(row?.credentialType);
    const accepted = await confirm(
      row?.credentialType === "oauth" ? `Re-authenticate ${name}?` : `Sign in to ${name}?`,
      row?.credentialType === "api_key"
        ? "A successful sign-in replaces the stored API key and restarts every active pi process."
        : `${replacing ? "Replace the stored OAuth credential" : "Store OAuth credentials in pi"} and restart every active pi process after sign-in?`,
    );
    if (!accepted || tornDown) return { ok: false, cancelled: true };
    publish({ loading: true, error: "" });
    try {
      const data = await jsonPost("/oauth/start", { provider, replace: replacing });
      pollDelay = 500;
      applyFlow(data.flow);
      publish({ loading: false });
      return { ok: true, flow: data.flow };
    } catch (error) {
      if (error.name === "AbortError" || tornDown) return { ok: false };
      publish({ loading: false, error: error.message });
      notify("OAuth sign-in could not start", "error");
      return { ok: false };
    }
  }

  async function poll() {
    if (!visible || tornDown || flow?.status !== "pending") return flow;
    try {
      const data = await jsonPost("/oauth/status", { flowId: flow.flowId });
      applyFlow(data.flow);
      if (data.flow?.status === "succeeded") {
        notify(data.flow.restart?.status === "restarted" ? "Signed in; pi restarted" : "Signed in; check pi restart status");
        await load({ quiet: true });
      } else if (data.flow?.status === "failed") {
        notify("OAuth sign-in failed", "error");
      }
      return data.flow;
    } catch (error) {
      if (error.name === "AbortError" || tornDown || !visible) return flow;
      publish({ error: error.message });
      schedulePoll();
      return flow;
    }
  }

  async function respondOAuth({ requestId, value } = {}) {
    if (!flow?.flowId || tornDown) return { ok: false };
    try {
      const data = await jsonPost("/oauth/respond", { flowId: flow.flowId, requestId, value });
      pollDelay = 500;
      applyFlow(data.flow);
      return { ok: true, flow: data.flow };
    } catch (error) {
      if (error.name === "AbortError" || tornDown) return { ok: false };
      publish({ error: error.message });
      return { ok: false };
    }
  }

  async function cancelOAuth() {
    if (!flow?.flowId || tornDown) return { ok: false };
    stopPolling();
    try {
      const data = await jsonPost("/oauth/cancel", { flowId: flow.flowId });
      applyFlow(data.flow);
      return { ok: true, flow: data.flow };
    } catch (error) {
      if (error.name === "AbortError" || tornDown) return { ok: false };
      publish({ error: error.message });
      return { ok: false };
    }
  }

  async function logoutOAuth(provider) {
    if (tornDown) return { ok: false };
    const row = providers.find((item) => item.provider === provider);
    const name = providerName(row ?? { provider });
    const accepted = await confirm(
      `Sign out ${name} from pi?`,
      "Remove the OAuth credential from pi and restart every active pi process? This does not revoke access at the provider.",
    );
    if (!accepted || tornDown) return { ok: false, cancelled: true };
    publish({ loading: true, error: "" });
    try {
      const data = await jsonRequest("/oauth", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, restart: true }),
      });
      publish({ loading: false, lastRestart: data.restart ?? null });
      notify("Signed out from pi; upstream access was not revoked");
      if (data.source && data.source !== "not_configured") notify(`pi may still authenticate ${name} using ${data.source === "models_json" ? "models.json" : data.source}`);
      await load({ quiet: true });
      return { ok: true, restart: data.restart ?? null, source: data.source };
    } catch (error) {
      if (error.name === "AbortError" || tornDown) return { ok: false };
      const removed = Boolean(error.details?.credential);
      publish({ loading: false, error: error.message, lastRestart: error.details?.restart ?? null });
      notify(removed ? "Signed out from pi, but restart was incomplete" : "OAuth credential was not removed", "error");
      if (removed) await load({ quiet: true });
      return { ok: false, removed, restart: error.details?.restart ?? null, source: error.details?.source };
    }
  }

  function cancelAbandonedFlow() {
    if (flow?.status !== "pending") return;
    const abandoned = flow.flowId;
    flow = null;
    void fetchImpl("/oauth/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowId: abandoned }),
    }).catch(() => {});
  }

  function activate() {
    if (tornDown) return;
    visible = true;
    if (flow?.status === "pending") schedulePoll();
  }

  function deactivate() {
    if (tornDown) return;
    visible = false;
    stopPolling();
    activeRequest?.abort();
    activeRequest = null;
    cancelAbandonedFlow();
    publish({ flow: null });
  }

  function teardown() {
    if (tornDown) return;
    visible = false;
    stopPolling();
    activeRequest?.abort();
    activeRequest = null;
    cancelAbandonedFlow();
    tornDown = true;
    providers = [];
    setState({ providers: [], flow: null, setupMode: false, loading: false, error: "", lastRestart: null });
  }

  return Object.freeze({
    load, save, remove,
    startOAuth, poll, respondOAuth, cancelOAuth, logoutOAuth,
    activate, deactivate, teardown,
  });
}
