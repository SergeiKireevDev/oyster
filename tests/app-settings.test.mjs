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

test("typed app settings persist mutable workdir and default runner with documented precedence", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-settings-"));
  const databasePath = join(root, "app.sqlite");
  let store = await openAppStore({ databasePath });
  let timestamp = 0;
  let settings = createAppSettings({ repository: store.repositories.settings, startupWorkdir: "/startup", now: () => `time-${++timestamp}` });
  assert.deepEqual(await settings.hydrate(), { currentWorkdir: "/startup", defaultRunnerId: null });
  assert.equal(await settings.setCurrentWorkdir("/persisted/../persisted/workspace"), "/persisted/workspace");
  assert.equal(await settings.setDefaultRunnerId("r-12345678"), "r-12345678");
  await assert.rejects(async () => await settings.setCurrentWorkdir("relative"), /absolute path/);
  await assert.rejects(async () => await settings.setDefaultRunnerId("r1"), /invalid/);
  await store.close();

  store = await openAppStore({ databasePath });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  settings = createAppSettings({ repository: store.repositories.settings, startupWorkdir: "/new-startup" });
  assert.deepEqual(await settings.hydrate(), { currentWorkdir: "/persisted/workspace", defaultRunnerId: "r-12345678" }, "valid persisted mutable values override startup configuration");

  await store.repositories.settings.set(APP_SETTING_KEYS.currentWorkdir, JSON.stringify("relative"), "bad");
  await store.repositories.settings.set(APP_SETTING_KEYS.defaultRunnerId, JSON.stringify("r1"), "bad");
  assert.deepEqual(await settings.hydrate(), { currentWorkdir: "/new-startup", defaultRunnerId: null }, "invalid persisted values fall back to validated startup defaults");
  assert.equal((await store.repositories.settings.get(APP_SETTING_KEYS.currentWorkdir)).key, APP_SETTING_KEYS.currentWorkdir);
});

test("typed app settings tolerate corrupt rows but surface repository failures", async () => {
  const values = new Map([
    [APP_SETTING_KEYS.currentWorkdir, { value: "not-json" }],
    [APP_SETTING_KEYS.defaultRunnerId, { value: JSON.stringify("r-invalid") }],
  ]);
  const repository = {
    get(key) { return values.get(key); },
    set() {},
  };
  const settings = createAppSettings({ repository, startupWorkdir: "/startup" });
  assert.deepEqual(await settings.hydrate(), { currentWorkdir: "/startup", defaultRunnerId: null });

  repository.get = () => { throw new Error("database unavailable"); };
  await assert.rejects(async () => await settings.hydrate(), /database unavailable/);
});

test("typed app settings validate dependencies and workdir resource bounds", async () => {
  assert.throws(
    () => createAppSettings({ repository: { get: true, set() {} }, startupWorkdir: "/startup" }),
    /repository is required/,
  );
  assert.throws(
    () => createAppSettings({ repository: { get() {}, set() {} }, startupWorkdir: "/startup", now: "later" }),
    /now must be a function/,
  );

  const settings = createAppSettings({ repository: { get() {}, set() {} }, startupWorkdir: "/startup" });
  await assert.rejects(async () => await settings.setCurrentWorkdir("/bad\0path"), /null bytes/);
  await assert.rejects(async () => await settings.setCurrentWorkdir(`/${"a".repeat(16 * 1024)}`), /16 KiB/);
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
