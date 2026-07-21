import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../app.mjs", import.meta.url), "utf8");

test("app composition uses extracted open and static route factories", () => {
  assert.match(appSource, /createOpenRoutes\(\{ state, listRunnerInfo, requestContext \}\)/);
  assert.match(appSource, /createStaticRoutes\(\{ config, requestContext \}\)/);
  assert.match(appSource, /createRouteTable\(\{[^}]*static: staticRoutes[^}]*open: openRoutes[^}]*authenticated: routes[^}]*\}\)/);
});

test("app no longer contains open or static route handler implementations", () => {
  for (const staleImplementation of [
    "function isAppRoute",
    "function serveApp",
    "function servePublicAsset",
    "STATIC_TYPES",
    "INDEX_PATH",
    "PUBLIC_DIR",
    "DIST_DIR",
    '"GET /health":',
    '"GET /authcheck":',
  ]) {
    assert.equal(appSource.includes(staleImplementation), false, `stale app implementation: ${staleImplementation}`);
  }
});
