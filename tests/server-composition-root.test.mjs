import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../app.mjs", import.meta.url), "utf8");
const stableSource = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

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
  assert.doesNotMatch(source, /openAppStore|node:sqlite/);
});
