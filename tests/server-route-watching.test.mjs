import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

test("stable core watches app and HTTP directories with one debounced reload scheduler", () => {
  assert.match(source, /const scheduleReload = \(changed\) => \{/);
  assert.match(source, /clearTimeout\(reloadTimer\)/);
  assert.match(source, /setTimeout\(async \(\) => \{[\s\S]*?await loadApp\(\)/);
  assert.match(source, /const httpDir = join\(__dirname, "http"\)/);
  assert.match(source, /const routeDir = join\(httpDir, "routes"\)/);
  assert.match(source, /for \(const directory of \[httpDir, routeDir\]\)/);
  assert.match(source, /filename\?\.endsWith\("\.mjs"\)/);
  assert.match(source, /filename === "app\.mjs"/);
  assert.match(source, /const distDir = join\(__dirname, "dist"\)/);
  assert.match(source, /for \(const directory of \[distDir, assetsDir\]\)/);
  assert.doesNotMatch(source, /watch\(publicDir/);
});
