import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("../public/src/components/CredentialsModal.svelte", import.meta.url), "utf8");
const overlays = readFileSync(new URL("../public/src/components/Overlays.svelte", import.meta.url), "utf8");
const store = readFileSync(new URL("../public/src/stores/credentials.js", import.meta.url), "utf8");

test("Credentials modal is owned by the overlay and covers safe provider states", () => {
  assert.match(overlays, /import CredentialsModal from "\.\/CredentialsModal\.svelte"/);
  assert.match(overlays, /\$modalState\.content === "credentials"[\s\S]*?<CredentialsModal/);
  for (const label of ["stored API key", "stored OAuth", "environment", "models.json", "not configured"]) {
    assert.ok(modal.includes(label), `missing source label: ${label}`);
  }
  assert.match(modal, /provider\.credentialType === "oauth"[\s\S]*?Re-authenticate[\s\S]*?Sign out from pi/);
});

test("Credentials modal exposes API-key and OAuth actions with revocation and fallback warnings", () => {
  assert.match(modal, /provider\.credentialType === "oauth"[\s\S]*?provider\.oauthCapable[\s\S]*?Re-authenticate[\s\S]*?Sign out from pi/);
  assert.match(modal, /provider\.credentialType === "api_key"[\s\S]*?Remove from pi and restart/);
  assert.match(modal, /uiActions\.invoke\(CREDENTIALS_REMOVE_API_KEY_ACTION, provider\)/);
  assert.match(modal, /uiActions\.invoke\(CREDENTIALS_START_OAUTH_ACTION, provider\)/);
  assert.match(modal, /uiActions\.invoke\(CREDENTIALS_LOGOUT_OAUTH_ACTION, provider\)/);
  assert.match(modal, /does not revoke it at the upstream provider/);
  assert.match(modal, /environment or models\.json fallback remains/);
  assert.match(modal, /pi may continue to authenticate after removal/);
});

test("Credentials modal renders accessible browser, device, prompt, selection, cancellation, and terminal OAuth states", () => {
  assert.match(modal, /aria-label="OAuth sign-in"[^>]*aria-live="polite"/);
  assert.match(modal, /target="_blank" rel="noopener noreferrer">Open authorization page/);
  assert.match(modal, /Device code[\s\S]*?readonly[\s\S]*?\.select\(\)/);
  assert.match(modal, /Open device verification/);
  assert.match(modal, /request\.kind === "select"[\s\S]*?chooseOAuth\(request, option\.id\)/);
  assert.match(modal, /name="oauthResponse"[\s\S]*?autocomplete="off"/);
  assert.match(modal, /unreachable loopback page[\s\S]*?redirect URL or authorization code/);
  assert.match(modal, /CREDENTIALS_CANCEL_OAUTH_ACTION/);
  for (const text of ["Sign-in completed", "Sign-in expired", "Sign-in cancelled", "Sign-in failed", "Pi restart:"]) {
    assert.ok(modal.includes(text), `missing OAuth state: ${text}`);
  }
});

test("API Keys modal form keeps submitted keys local and clears them on every exit", () => {
  assert.match(modal, /type="password"/);
  assert.match(modal, /autocomplete="off"/);
  assert.match(modal, /autocapitalize="none"/);
  assert.match(modal, /autocorrect="off"/);
  assert.match(modal, /spellcheck="false"/);
  assert.match(modal, /Save and restart pi/);
  assert.match(modal, /Replace and restart pi/);
  assert.match(modal, /uiActions\.invoke\(CREDENTIALS_SAVE_API_KEY_ACTION, \{ provider: selectedProvider, key \}\)/);
  assert.match(modal, /finally \{[\s\S]*?clearKey\(\)/);
  assert.match(modal, /function close\(\) \{[\s\S]*?clearKey\(\)/);
  assert.match(modal, /onDestroy\(\(\) => \{[\s\S]*?clearKey\(\)[\s\S]*?CREDENTIALS_CLOSE_ACTION/);
  assert.doesNotMatch(modal, /bind:value=\{key/);
});

test("API Keys modal renders loading empty error and restart feedback without credential fields", () => {
  assert.match(modal, /Loading provider credentials/);
  assert.match(modal, /No providers are available/);
  assert.match(modal, /role="alert"/);
  assert.match(modal, /Restart status:/);
  assert.doesNotMatch(modal, /provider\.(?:key|token|access|refresh|secret)/);
  assert.doesNotMatch(store, /\b(?:key|token|secret)\s*:/i);
});
