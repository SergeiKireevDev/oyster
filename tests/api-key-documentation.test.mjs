import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const readme = read("../README.md");
const app = read("../server/app.mjs");
const menu = read("../public/src/components/Menu.svelte");
const overlays = read("../public/src/components/Overlays.svelte");
const root = read("../public/src/runtime/appCompositionRoot.js");
const modalHistory = read("../public/src/lib/modalHistoryController.js");

test("API-key endpoint documentation captures auth, body, restart, and removal semantics", () => {
  for (const route of ["GET /api-keys", "POST /api-keys", "DELETE /api-keys"]) {
    assert.ok(readme.includes(`\`${route}\``), `missing ${route}`);
  }
  assert.match(readme, /PI_CODING_AGENT_DIR\/auth\.json/);
  assert.match(readme, /mode `0600`/);
  assert.match(readme, /stored `auth\.json` credential takes precedence/);
  assert.match(readme, /environment or `models\.json` fallback/);
  assert.match(readme, /does not revoke the key at\s+the upstream provider/);
  assert.match(readme, /restarts\s+every pi runner that was active/);
});

test("credential route composition and UI ownership remain explicit", () => {
  assert.match(app, /createCredentialRoutes/);
  assert.match(app, /createOAuthRoutes/);
  assert.match(app, /credential: credentialRoutes/);
  assert.match(app, /oauth: oauthRoutes/);
  assert.match(menu, /data-action="credentials"/);
  assert.match(overlays, /content === "credentials"[\s\S]*?<CredentialsModal/);
  assert.match(root, /createCredentialsAssembly/);
  assert.match(root, /credentialsAssembly\.teardown/);
  assert.doesNotMatch(root, /showSettingsModal[^\n]*credentials|credentials[^\n]*showSettingsModal/);
});

test("OAuth documentation covers transient flow and local sign-out semantics", () => {
  for (const route of ["POST /oauth/start", "POST /oauth/status", "POST /oauth/respond", "POST /oauth/cancel", "DELETE /oauth"]) {
    assert.ok(readme.includes(`\`${route}\``), `missing ${route}`);
  }
  assert.match(readme, /AuthStorage\.getOAuthProviders/);
  assert.match(readme, /PKCE\/state checks/);
  assert.match(readme, /Flows expire after 15 minutes/);
  assert.match(readme, /loopback callback[\s\S]*?paste it into\s+the modal/);
  assert.match(readme, /does not revoke its OAuth grant/);
  assert.match(readme, /no entries in `auth\.json`[\s\S]*?setup once/);
});

test("Credentials modal participates in generic modal history without owning browser history", () => {
  assert.match(modalHistory, /pushState/);
  assert.match(modalHistory, /popstate/);
  const credentialsModal = read("../public/src/components/CredentialsModal.svelte");
  assert.doesNotMatch(credentialsModal, /history\.|pushState|popstate|addEventListener/);
});
