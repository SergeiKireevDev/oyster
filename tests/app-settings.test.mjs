import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APP_SETTING_KEYS,
  assertGeneralAppSettingKey,
  assertGeneralAppSettingValue,
  createAppSettings,
} from "../server/persistence/appSettings.mjs";
import { openAppStore } from "../server/persistence/appStore.mjs";

test("typed app settings persist mutable workdir and default runner with documented precedence", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-settings-"));
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
  store.repositories.settings.set(APP_SETTING_KEYS.defaultRunnerId, JSON.stringify("r1"), "bad");
  assert.deepEqual(settings.hydrate(), { currentWorkdir: "/new-startup", defaultRunnerId: null }, "invalid persisted values fall back to validated startup defaults");
  assert.equal(store.repositories.settings.get(APP_SETTING_KEYS.currentWorkdir).key, APP_SETTING_KEYS.currentWorkdir);
});

test("typed app settings tolerate corrupt rows but surface repository failures", () => {
  const values = new Map([
    [APP_SETTING_KEYS.currentWorkdir, { value: "not-json" }],
    [APP_SETTING_KEYS.defaultRunnerId, { value: JSON.stringify("r-invalid") }],
  ]);
  const repository = {
    get(key) { return values.get(key); },
    set() {},
  };
  const settings = createAppSettings({ repository, startupWorkdir: "/startup" });
  assert.deepEqual(settings.hydrate(), { currentWorkdir: "/startup", defaultRunnerId: null });

  repository.get = () => { throw new Error("database unavailable"); };
  assert.throws(() => settings.hydrate(), /database unavailable/);
});

test("typed app settings validate dependencies and workdir resource bounds", () => {
  assert.throws(
    () => createAppSettings({ repository: { get: true, set() {} }, startupWorkdir: "/startup" }),
    /repository is required/,
  );
  assert.throws(
    () => createAppSettings({ repository: { get() {}, set() {} }, startupWorkdir: "/startup", now: "later" }),
    /now must be a function/,
  );

  const settings = createAppSettings({ repository: { get() {}, set() {} }, startupWorkdir: "/startup" });
  assert.throws(() => settings.setCurrentWorkdir("/bad\0path"), /null bytes/);
  assert.throws(() => settings.setCurrentWorkdir(`/${"a".repeat(16 * 1024)}`), /16 KiB/);
});

test("general app setting validation rejects malformed JSON and scans deeply without recursion", () => {
  assert.throws(() => assertGeneralAppSettingValue("not-json"), /valid serialized JSON/);
  assert.throws(() => assertGeneralAppSettingKey("profile.apiKey"), /forbidden/);
  assert.throws(
    () => assertGeneralAppSettingValue(JSON.stringify({ "profile/clientSecret": "canary" })),
    /forbidden/,
  );

  const depth = 20_000;
  const deeplyNested = `${'{"ordinary":'.repeat(depth)}null${"}".repeat(depth)}`;
  assert.equal(assertGeneralAppSettingValue(deeplyNested), deeplyNested);
});
