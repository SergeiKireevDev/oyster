import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { APP_SETTING_KEYS, BROWSER_PREFERENCE_SYNC_POLICY } from "../persistence/appSettings.mjs";

test("general app settings reject authentication and credential keys", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-auth-setting-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  for (const key of [
    "token", "pi_ui_token", "authToken", "refresh-token", "client_secret",
    "passwordHash", "credential_store", "bearer", "apiKey", "private_key",
  ]) {
    assert.throws(() => store.repositories.settings.set(key, '"sensitive"', "now"), /forbidden in general app settings/, key);
  }
  assert.deepEqual(store.repositories.settings.list(), []);
  store.repositories.settings.set(APP_SETTING_KEYS.currentWorkdir, '"/workspace"', "now");
  assert.equal(store.repositories.settings.list().length, 1, "non-secret typed settings remain supported");
});

test("authentication storage remains outside preference and SQLite setting surfaces", () => {
  assert.equal(BROWSER_PREFERENCE_SYNC_POLICY.keys.includes("pi_ui_token"), false);
  assert.equal(Object.values(APP_SETTING_KEYS).some((key) => /token|secret|password|credential/i.test(key)), false);
  const authClient = readFileSync(new URL("../public/src/runtime/authClient.js", import.meta.url), "utf8");
  const authBrowser = readFileSync(new URL("../public/src/runtime/authBrowserService.js", import.meta.url), "utf8");
  assert.match(`${authClient}\n${authBrowser}`, /pi_ui_token/);
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /argValue\("--token"\) \?\? process\.env\.PI_UI_TOKEN \?\? defaultToken\(\)/);
  assert.doesNotMatch(server, /repositories\.settings\.set\([^\n]*(?:TOKEN|token)/);
});
