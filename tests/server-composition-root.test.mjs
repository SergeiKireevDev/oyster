import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../app.mjs", import.meta.url), "utf8");
const stableSource = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const appStoreSource = readFileSync(new URL("../persistence/appStore.mjs", import.meta.url), "utf8");

test("app is a small disposable composition root", () => {
  assert.ok(source.split("\n").length < 200);
  assert.match(source, /export async function init\(state\)/);
  assert.match(source, /createRequestContext\(state\)/);
  assert.match(source, /createRouteTable\(\{/);
  assert.match(source, /await import\(bust\("runners\.mjs"\)\)/);
  assert.match(source, /handleRequest, startPi, stopPi/);
  assert.equal(source.includes("const routes ="), false);
  assert.equal(source.includes("misc app logic"), false);
  assert.equal(source.includes("Routes:"), false);
});

test("stable core owns one app-store service across application reloads", () => {
  assert.equal((stableSource.match(/openAppStore\(\{/g) ?? []).length, 1);
  assert.match(stableSource, /const appStore = openAppStore\(\{ databasePath: config\.PI_UI_DB_PATH \}\);/);
  assert.match(stableSource, /const state = \{[\s\S]*?appStore,/);
  assert.match(stableSource, /state\.appStore\.close\(\);/);
  assert.ok(stableSource.indexOf("const appStore = openAppStore") < stableSource.indexOf("await loadApp();"));
  assert.doesNotMatch(source, /openAppStore|node:sqlite/);
});

test("composition injects the narrow app store into persistent domains", () => {
  assert.match(appStoreSource, /repositories,[\s\S]*migrationStatus,[\s\S]*transaction,[\s\S]*get closed\(\)[\s\S]*close\(\)/);
  assert.equal(appStoreSource.includes("database,"), false, "raw database handle must remain private");
  assert.match(source, /createRunnerManager\(state, \{ appStore \}\)/);
  assert.match(source, /createCheckpointRoutes\(\{[\s\S]*?state, appStore,/);
  assert.match(source, /createRoutineRoutes\(\{[\s\S]*?state, appStore,/);
  assert.match(source, /createTunnelRoutes\(\{[\s\S]*?state, appStore,/);
  assert.match(source, /createSessionRoutes\(\{[\s\S]*?state,[\s\S]*?appStore,/);
  assert.match(source, /createWorkdirRoutes\(\{ state, appStore,/);
});
