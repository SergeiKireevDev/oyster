export const AUTH_TOKEN_KEY = "oyster_token";

/** Mount-scoped browser effects used by the authentication gate. */
export function createAuthBrowserService({ storage, reload, fetchImpl = fetch }) {
  return Object.freeze({
    async validateToken(token) {
      const response = await fetchImpl("/authcheck", {
        headers: { "x-auth-token": token },
      });
      if (!response.ok) return false;
      const report = await response.json().catch(() => null);
      // Check the submitted header itself: a valid stale cookie must not make an
      // invalid token pass validation.
      return report?.credentials?.xAuthToken === "valid";
    },
    saveToken(token) {
      storage.setItem(AUTH_TOKEN_KEY, token);
    },
    reload() {
      reload();
    },
  });
}
