import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppSettings, APP_SETTING_KEYS } from "../persistence/appSettings.mjs";
import { openAppStore } from "../persistence/appStore.mjs";

test("typed app settings persist mutable workdir and default runner with documented precedence", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-settings-"));
  const databasePath = join(root, "app.sqlite");
  let store = openAppStore({ databasePath });
  let timestamp = 0;
  let settings = createAppSettings({ repository: store.repositories.settings, startupWorkdir: "/startup", now: () => `time-${++timestamp}` });
  assert.deepEqual(settings.hydrate(), { currentWorkdir: "/startup", defaultRunnerId: null });
  assert.equal(settings.setCurrentWorkdir("/persisted/../persisted/workspace"), "/persisted/workspace");
  assert.equal(settings.setDefaultRunnerId("r-12345678"), "r-12345678");
  assert.throws(() => settings.setCurrentWorkdir("relative"), /absolute path/);
  assert.throws(() => settings.setDefaultRunnerId("r1"), /invalid/);
  store.close();

  store = openAppStore({ databasePath });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  settings = createAppSettings({ repository: store.repositories.settings, startupWorkdir: "/new-startup" });
  assert.deepEqual(settings.hydrate(), { currentWorkdir: "/persisted/workspace", defaultRunnerId: "r-12345678" }, "valid persisted mutable values override startup configuration");

  store.repositories.settings.set(APP_SETTING_KEYS.currentWorkdir, JSON.stringify("relative"), "bad");
  store.repositories.settings.set(APP_SETTING_KEYS.defaultRunnerId, "not-json", "bad");
  assert.deepEqual(settings.hydrate(), { currentWorkdir: "/new-startup", defaultRunnerId: null }, "invalid persisted values fall back to validated startup defaults");
  assert.equal(store.repositories.settings.get(APP_SETTING_KEYS.currentWorkdir).key, APP_SETTING_KEYS.currentWorkdir);
});
