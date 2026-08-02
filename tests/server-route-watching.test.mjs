import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../server/server.mjs", import.meta.url), "utf8");

test("stable core watches the reload manifest with one debounced scheduler", () => {
  assert.match(source, /import \{ RELOADABLE_SERVER_MODULES \} from "\.\/reload-manifest\.mjs"/);
  assert.match(source, /const scheduleReload = \(changed\) => \{/);
  assert.match(source, /clearTimeout\(reloadTimer\)/);
  assert.match(source, /reloadTimer = setTimeout\(\(\) => \{[\s\S]*?void drainReloads\(\)/);
  assert.match(source, /if \(reloadInProgress \|\| shuttingDown \|\| !pendingReload\) return activeReload;[\s\S]*?activeReload = \(async \(\) => \{[\s\S]*?await loadApp\(\)/);
  assert.match(source, /const reloadable = new Set\(RELOADABLE_SERVER_MODULES\)/);
  assert.match(source, /RELOADABLE_SERVER_MODULES\.map\(\(module\) => dirname\(module\)\)/);
  assert.match(source, /for \(const relativeDirectory of reloadDirectories\)/);
  assert.match(source, /if \(reloadable\.has\(relativeModule\)\) scheduleReload\(relativeModule\)/);
  assert.match(source, /const distDir = join\(PROJECT_ROOT, "dist"\)/);
  assert.match(source, /for \(const directory of \[distDir, assetsDir\]\)/);
  assert.doesNotMatch(source, /watch\(publicDir/);
});
