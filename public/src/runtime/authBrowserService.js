export const AUTH_TOKEN_KEY = "pi_ui_token";

/** Mount-scoped browser effects used by the authentication gate. */
export function createAuthBrowserService({ storage, reload }) {
  return Object.freeze({
    saveToken(token) {
      storage.setItem(AUTH_TOKEN_KEY, token);
    },
    reload() {
      reload();
    },
  });
}
