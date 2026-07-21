import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { APP_SETTING_KEYS, BROWSER_PREFERENCE_SYNC_POLICY } from "../server/persistence/appSettings.mjs";

test("general app settings reject authentication and credential keys", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-auth-setting-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  for (const key of [
    "token", "pi_ui_token", "authToken", "refresh-token", "client_secret",
    "passwordHash", "credential_store", "bearer", "apiKey", "private_key",
    "oauthFlow", "authorization_code", "device-code", "redirectUrl", "flow_snapshot", "promptResponse",
  ]) {
    assert.throws(() => store.repositories.settings.set(key, '"sensitive"', "now"), /forbidden in general app settings/, key);
  }
  for (const value of [
    JSON.stringify({ apiKey: "canary" }),
    JSON.stringify({ nested: { refresh_token: "canary" } }),
    JSON.stringify([{ clientSecret: "canary" }]),
    JSON.stringify({ oauth: { authorizationCode: "canary", redirectUrl: "https://callback.invalid/?code=canary" } }),
    JSON.stringify({ transient: { deviceCode: "canary", flowId: "canary", promptResponse: "canary" } }),
  ]) {
    assert.throws(
      () => store.repositories.settings.set("otherwise_safe", value, "now"),
      /forbidden in general app settings/,
    );
  }
  assert.deepEqual(store.repositories.settings.list(), []);
  store.repositories.settings.set(APP_SETTING_KEYS.currentWorkdir, '"/workspace"', "now");
  assert.equal(store.repositories.settings.list().length, 1, "non-secret typed settings remain supported");
});

test("credential services and routes cannot cross into general settings or browser preferences", () => {
  const serverCredentialSources = [
    "../server/pi-credential-service.mjs",
    "../server/pi-oauth-flow-service.mjs",
    "../server/http/routes/credentialRoutes.mjs",
    "../server/http/routes/oauthRoutes.mjs",
    "../server/runner-restart-service.mjs",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(serverCredentialSources, /repositories\.settings|appSettings|app_settings/);

  const browserCredentialSources = [
    "../public/src/features/credentials/createCredentialsController.js",
    "../public/src/features/credentials/createCredentialsAssembly.js",
    "../public/src/stores/credentials.js",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(browserCredentialSources, /localStorage|sessionStorage|settingsPreference|SettingsModal|pushState|replaceState/);
  assert.equal(BROWSER_PREFERENCE_SYNC_POLICY.keys.some((key) => /auth|oauth|token|secret|credential|api.?key|code|redirect|flow|prompt/i.test(key)), false);

  const app = readFileSync(new URL("../server/app.mjs", import.meta.url), "utf8");
  const inventory = readFileSync(new URL("../server/persistence/stateInventory.mjs", import.meta.url), "utf8");
  const flowService = readFileSync(new URL("../server/pi-oauth-flow-service.mjs", import.meta.url), "utf8");
  assert.match(app, /state\.oauthFlows \?\?= new Map\(\)/);
  assert.match(inventory, /oauthFlows: entry\("ephemeral"/);
  assert.match(flowService, /createPiOAuthFlowService\(\{[\s\S]*?registry/);
  assert.doesNotMatch(flowService, /^(?:export )?const\s+\w*[Rr]egistry\w*\s*=\s*new Map/m);
});

test("authentication storage remains outside preference and SQLite setting surfaces", () => {
  assert.equal(BROWSER_PREFERENCE_SYNC_POLICY.keys.includes("pi_ui_token"), false);
  assert.equal(Object.values(APP_SETTING_KEYS).some((key) => /token|secret|password|credential/i.test(key)), false);
  const authClient = readFileSync(new URL("../public/src/runtime/authClient.js", import.meta.url), "utf8");
  const authBrowser = readFileSync(new URL("../public/src/runtime/authBrowserService.js", import.meta.url), "utf8");
  assert.match(`${authClient}\n${authBrowser}`, /pi_ui_token/);
  const server = readFileSync(new URL("../server/server.mjs", import.meta.url), "utf8");
  assert.match(server, /argValue\("--token"\) \?\? process\.env\.PI_UI_TOKEN \?\? defaultToken\(\)/);
  assert.doesNotMatch(server, /repositories\.settings\.set\([^\n]*(?:TOKEN|token)/);
});
