export function initializeAuth() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const fromUrl = hash.get("token") || query.get("token");
  if (fromUrl) {
    localStorage.setItem("pi_ui_token", fromUrl.trim());
    history.replaceState(null, "", location.pathname);
  }
  const token = (localStorage.getItem("pi_ui_token") || "").trim() || null;
  if (token) document.cookie = `pi_ui_token=${encodeURIComponent(token)}; path=/; max-age=31536000; samesite=strict`;
  return token;
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

export function installAuthenticatedFetch(token) {
  const rawFetch = window.fetch.bind(window);
  window.fetch = (input, opts = {}) => {
    if (typeof input === "string" && input.startsWith("/") && token) {
      opts = { ...opts, headers: { "x-auth-token": token, ...(opts.headers || {}) } };
    }
    return rawFetch(input, opts);
  };
}
