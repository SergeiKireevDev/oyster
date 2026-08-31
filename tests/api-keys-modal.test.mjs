import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("../public/src/components/CredentialsModal.svelte", import.meta.url), "utf8");
const modalRegistry = readFileSync(new URL("../public/src/runtime/modalContentRegistry.js", import.meta.url), "utf8");
const store = readFileSync(new URL("../public/src/stores/credentials.js", import.meta.url), "utf8");

test("Credentials modal is owned by the overlay and covers safe provider states", () => {
  assert.match(modalRegistry, /import CredentialsModal from "\.\.\/components\/CredentialsModal\.svelte"/);
  assert.match(modalRegistry, /credentials: CredentialsModal/);
  for (const label of ["stored API key", "stored OAuth", "environment", "models.json", "not configured"]) {
    assert.ok(modal.includes(label), `missing source label: ${label}`);
  }
  assert.match(modal, /provider\.credentialType === "oauth"[\s\S]*?Re-authenticate[\s\S]*?Sign out from pi/);
  assert.match(modal, /<button class="chip" type="button" data-modal-cancel onclick=\{close\}>Close<\/button>/);
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

test("OAuth credential actions use shared controls and semantic palette tokens", () => {
  assert.match(modal, /class="chip api-key-oauth"/);
  assert.match(modal, /\.api-key-status \.api-key-oauth \{ color: var\(--accent\); \}/);
  assert.match(modal, /class="chip api-key-remove"/);
  assert.match(modal, /\.api-key-status \.api-key-remove \{[\s\S]*?var\(--red\)/);
  assert.match(modal, /class="chip oauth-cancel"/);
  assert.match(modal, /\.oauth-cancel \{[^}]*color: var\(--red\)/);
});

test("the status list shows only active providers while the selector includes inactive OAuth providers", () => {
  assert.match(modal, /activeProviders = \$credentialsState\.providers\.filter\(\(provider\) => provider\.configured\)/);
  assert.match(modal, /selectableProviders = \$credentialsState\.providers\.filter[\s\S]*?provider\.oauthCapable/);
  assert.match(modal, /aria-label="Active provider credential status"[\s\S]*?each activeProviders as provider/);
  assert.match(modal, /each selectableProviders as provider/);
});

test("selecting an OAuth-capable provider defaults to OAuth instead of requesting an API key", () => {
  assert.match(modal, /selectedProvider !== methodProvider[\s\S]*?authenticationMethod = selected\?\.oauthCapable \? "oauth" : "api_key"/);
  assert.match(modal, /selected\?\.oauthCapable && authenticationMethod === "oauth"[\s\S]*?oauthActionLabel\(selected\)/);
  assert.match(modal, /function oauthActionLabel\(provider\)[\s\S]*?"Sign in with OAuth"/);
  assert.match(modal, /onclick=\{\(\) => startOAuth\(selectedProvider\)\}/);
  assert.match(modal, /Use an API key instead/);
  assert.match(modal, /Use OAuth instead/);
});

test("Credentials modal renders accessible browser, device, prompt, selection, cancellation, and terminal OAuth states", () => {
  assert.match(modal, /aria-label="OAuth sign-in"[^>]*aria-live="polite"/);
  assert.match(modal, /target="_blank" rel="noopener noreferrer">Open authorization page/);
  assert.match(modal, /Device code[\s\S]*?readonly[\s\S]*?\.select\(\)/);
  assert.match(modal, /copyTextToClipboard\(code\)[\s\S]*?oauth-device-code-entry[\s\S]*?oauth-device-code-copy[\s\S]*?"Copy"/);
  assert.match(modal, /enter this one-time code[\s\S]*?finish binding pi to your account automatically/);
  assert.match(modal, /Open verification page/);
  assert.match(modal, /request\.kind === "select"[\s\S]*?chooseOAuth\(request, option\.id\)/);
  assert.match(modal, /name="oauthResponse"[\s\S]*?autocomplete="off"/);
  assert.match(modal, /oninput=\{\(event\) => updateOAuthInput\(event, request\.requestId\)\}/);
  assert.match(modal, /disabled=\{oauthOperationPending \|\| !oauthInputReady\[request\.requestId\]\}>Continue/);
  assert.match(modal, /unreachable loopback page[\s\S]*?redirect URL or authorization code/);
  assert.match(modal, /CREDENTIALS_CANCEL_OAUTH_ACTION/);
  for (const text of ["Sign-in completed", "Sign-in expired", "Sign-in cancelled", "Sign-in failed", "Pi restart:"]) {
    assert.ok(modal.includes(text), `missing OAuth state: ${text}`);
  }
});

test("OAuth callback inputs stay component-local and clear on every lifecycle transition", () => {
  assert.match(modal, /let oauthInputs = new Set\(\)/);
  assert.match(modal, /let oauthInputReady = \{\}/);
  assert.match(modal, /updateOAuthInput[\s\S]*?value\.trim\(\)[\s\S]*?\[requestId\]: ready/);
  assert.match(modal, /use:trackOAuthInput/);
  assert.match(modal, /destroy\(\) \{[\s\S]*?node\.value = ""[\s\S]*?oauthInputs\.delete/);
  assert.match(modal, /nextRequestSignature !== requestSignature[\s\S]*?clearOAuthInputs\(\)/);
  assert.match(modal, /clearOAuthInputs[\s\S]*?oauthInputReady = \{\}/);
  assert.match(modal, /if \(!value\.trim\(\)\) return/);
  assert.match(modal, /finally \{[\s\S]*?input\.value = ""[\s\S]*?oauthInputReady/);
  assert.match(modal, /function cancelOAuth\(\) \{[\s\S]*?clearOAuthInputs\(\)[\s\S]*?CREDENTIALS_CANCEL_OAUTH_ACTION/);
  assert.match(modal, /function close\(\) \{[\s\S]*?clearOAuthInputs\(\)/);
  assert.match(modal, /onDestroy\(\(\) => \{[\s\S]*?clearOAuthInputs\(\)[\s\S]*?oauthInputs\.clear\(\)/);
  assert.match(modal, /if \(oauthOperationPending\) return;[\s\S]*?oauthOperationPending = true;[\s\S]*?oauthOperationPending = false/);
  assert.match(modal, /disabled=\{oauthOperationPending\} onclick=\{\(\) => chooseOAuth/);
  assert.match(modal, /disabled=\{oauthOperationPending\} onclick=\{cancelOAuth\}/);
  assert.doesNotMatch(modal, /bind:value=\{[^}]*oauth|localStorage|sessionStorage/);
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
  assert.match(modal, /onDestroy\(\(\) => \{[\s\S]*?clearKey\(\)[\s\S]*?keyInput = undefined[\s\S]*?deactivate\(\)/);
  assert.match(modal, /function deactivate\(options\) \{[\s\S]*?if \(deactivated\) return;[\s\S]*?CREDENTIALS_CLOSE_ACTION, options/);
  assert.match(modal, /deactivate\(\{ completedSetup: true \}\)/);
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
