import { getActiveWorkspace, isHubRuntime } from "./workspaceScope.js";

export const UNAUTHENTICATED_CLIENT_TOKEN = "__oyster_unauthenticated__";

export function initializeAuth({
  runtimeConfig = globalThis.__OYSTER_RUNTIME_CONFIG__,
  locationTarget = location,
  historyTarget = history,
  storage = localStorage,
  documentTarget = document,
} = {}) {
  // The marker is deliberately not persisted or sent as a cookie. It only lets
  // token-oriented browser transports boot; the server remains authoritative
  // about whether authentication is disabled.
  if (runtimeConfig?.unauthenticated === true) return UNAUTHENTICATED_CLIENT_TOKEN;

  const hash = new URLSearchParams(locationTarget.hash.slice(1));
  const query = new URLSearchParams(locationTarget.search);
  const fromUrl = hash.get("token") || query.get("token");
  if (fromUrl) {
    storage.setItem("oyster_token", fromUrl.trim());
    historyTarget.replaceState(null, "", locationTarget.pathname);
  }
  const token = (storage.getItem("oyster_token") || "").trim() || null;
  if (token) documentTarget.cookie = `oyster_token=${encodeURIComponent(token)}; path=/; max-age=31536000; samesite=strict`;
  return token;
}

/** Open and focus the authentication gate after an explicit unauthorized response. */
export function showAuthGate({ gate, input }) {
  gate.classList.add("open");
  input.focus();
}

/** Clear persisted authentication when the server explicitly rejects it. */
export function clearAuthToken({ storage, documentTarget }) {
  storage.removeItem("oyster_token");
  documentTarget.cookie = "oyster_token=; path=/; max-age=0";
}

/**
 * Confirm an RPC unauthorized response before discarding a saved token. This
 * avoids logging the user out for transient proxy or network failures.
 */
export function createUnauthorizedHandler({ fetchImpl = fetch, storage, documentTarget, requireToken, toast }) {
  let verifying = false;
  return async () => {
    if (verifying) return;
    verifying = true;
    try {
      const res = await fetchImpl("/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "get_state" }),
      });
      if (res.status === 401) {
        clearAuthToken({ storage, documentTarget });
        requireToken();
      } else {
        toast("temporary auth hiccup — retry", "warning");
      }
    } catch {
      toast("network error — retry", "warning");
    } finally {
      verifying = false;
    }
  };
}

export function createAuthProbe({ getToken, onUnauthorized, intervalMs = 10000 }) {
  let lastProbeAt = 0;
  return async () => {
    const now = Date.now();
    if (now - lastProbeAt < intervalMs || !getToken()) return;
    lastProbeAt = now;
    try {
      const res = await fetch("/authcheck");
      if (!res.ok) return;
      const data = await res.json();
      if (data.authorized === false) onUnauthorized();
    } catch {}
  };
}

export function installAuthenticatedFetch(token, { windowTarget = window } = {}) {
  const originalFetch = windowTarget.fetch;
  const rawFetch = originalFetch.bind(windowTarget);
  const authenticatedFetch = (input, opts = {}) => {
    if (typeof input === "string" && input.startsWith("/") && token) {
      const workspace = isHubRuntime() ? getActiveWorkspace(windowTarget.localStorage) : null;
      opts = {
        ...opts,
        headers: {
          "x-auth-token": token,
          ...(workspace ? { "x-oyster-workspace": workspace } : {}),
          ...(opts.headers || {}),
        },
      };
    }
    return rawFetch(input, opts);
  };
  windowTarget.fetch = authenticatedFetch;
  return {
    detach() {
      if (windowTarget.fetch === authenticatedFetch) windowTarget.fetch = originalFetch;
    },
  };
}
