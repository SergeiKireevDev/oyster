import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const readme = read("../README.md");
const app = read("../app.mjs");
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

test("API-key route composition and UI ownership remain explicit", () => {
  assert.match(app, /createCredentialRoutes/);
  assert.match(app, /credential: credentialRoutes/);
  assert.match(menu, /data-action="apiKeys"/);
  assert.match(overlays, /content === "apiKeys"[\s\S]*?<ApiKeysModal/);
  assert.match(root, /createCredentialsAssembly/);
  assert.match(root, /credentialsAssembly\.teardown/);
  assert.doesNotMatch(root, /showSettingsModal[^\n]*apiKeys|apiKeys[^\n]*showSettingsModal/);
});

test("API-key modal participates in generic modal history without owning browser history", () => {
  assert.match(modalHistory, /pushState/);
  assert.match(modalHistory, /popstate/);
  const apiModal = read("../public/src/components/ApiKeysModal.svelte");
  assert.doesNotMatch(apiModal, /history\.|pushState|popstate|addEventListener/);
});
