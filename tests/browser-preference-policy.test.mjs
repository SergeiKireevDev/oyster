import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { BROWSER_PREFERENCE_SYNC_POLICY, APP_SETTING_KEYS, createAppSettings } from "../server/persistence/appSettings.mjs";

const browserSources = [
  "../public/src/runtime/settingsPreferenceService.js",
  "../public/src/runtime/carouselController.js",
  "../public/src/runtime/sessionRuntime.js",
  "../public/src/App.svelte",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");

test("non-secret browser preferences deliberately remain device-local", () => {
  assert.equal(BROWSER_PREFERENCE_SYNC_POLICY.syncToSqlite, false);
  assert.equal(BROWSER_PREFERENCE_SYNC_POLICY.storage, "browser-localStorage");
  assert.match(BROWSER_PREFERENCE_SYNC_POLICY.rationale, /device-specific/);
  assert.deepEqual(BROWSER_PREFERENCE_SYNC_POLICY.keys, [
    "pi_show_thinking", "pi_carousel", "pi_ckpt_model", "pi_runner",
  ]);
  for (const key of BROWSER_PREFERENCE_SYNC_POLICY.keys) {
    assert.match(browserSources, new RegExp(key), `${key} must remain implemented in browser storage`);
    assert.equal(Object.values(APP_SETTING_KEYS).includes(key), false, `${key} must not become a server app setting`);
  }
});

test("typed app settings expose no browser-preference synchronization surface", () => {
  const rows = new Map();
  const settings = createAppSettings({
    startupWorkdir: "/workspace",
    repository: {
      get: (key) => rows.get(key) ?? null,
      set(key, value, updated_at) { rows.set(key, { key, value, updated_at }); },
    },
  });
  assert.deepEqual(Object.keys(settings), ["hydrate", "setCurrentWorkdir", "setDefaultRunnerId"]);
  const routeSources = readdirSync(new URL("../server/http/routes", import.meta.url))
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => readFileSync(new URL(`../server/http/routes/${name}`, import.meta.url), "utf8"))
    .join("\n");
  assert.doesNotMatch(routeSources, /["'](?:GET|POST|PATCH) \/(?:preferences|settings)["']/);
});
