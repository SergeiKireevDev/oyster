import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const credentialGuide = read("../docs/user-guide/credentials.md");
const httpApi = read("../docs/reference/http-api.md");
const app = read("../server/app.mjs");
const menu = read("../public/src/components/Menu.svelte");
const overlays = read("../public/src/components/Overlays.svelte");
const root = read("../public/src/runtime/appCompositionRoot.js");
const modalHistory = read("../public/src/lib/modalHistoryController.js");

test("API-key documentation captures ownership, endpoints, restart, and removal semantics", () => {
  for (const route of ["GET /api-keys", "POST /api-keys", "DELETE /api-keys"]) {
    assert.ok(httpApi.includes(`\`${route}\``), `missing ${route}`);
  }
  assert.match(credentialGuide, /PI_CODING_AGENT_DIR\/auth\.json/);
  assert.match(credentialGuide, /mode `0600`/);
  assert.match(credentialGuide, /stored `auth\.json` credential takes precedence/);
  assert.match(credentialGuide, /environment variables and `models\.json`/);
  assert.match(credentialGuide, /Removing a key only deletes pi's local copy/);
  assert.match(credentialGuide, /credential mutation restarts the runners that were active/);
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
    assert.ok(httpApi.includes(`\`${route}\``), `missing ${route}`);
  }
  assert.match(credentialGuide, /AuthStorage/);
  assert.match(credentialGuide, /PKCE and state validation/);
  assert.match(credentialGuide, /flows expire after 15 minutes/i);
  assert.match(credentialGuide, /loopback redirect[\s\S]*?paste it into the modal/);
  assert.match(credentialGuide, /does not revoke the upstream grant/);
});

test("Credentials modal participates in generic modal history without owning browser history", () => {
  assert.match(modalHistory, /pushState/);
  assert.match(modalHistory, /popstate/);
  const credentialsModal = read("../public/src/components/CredentialsModal.svelte");
  assert.doesNotMatch(credentialsModal, /history\.|pushState|popstate|addEventListener/);
});
