import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../app.mjs", import.meta.url), "utf8");

test("app composes resource factories without tunnel or routine route bodies", () => {
  for (const route of ["GET /tunnels", "POST /tunnels", "PATCH /tunnels", "DELETE /tunnels", "GET /routines", "POST /routines"]) {
    assert.equal(source.includes(`"${route}":`), false, `stale resource route: ${route}`);
  }
  assert.match(source, /tunnel: tunnelRoutes/);
  assert.match(source, /routine: routineRoutes/);
});

test("composed lifecycle API retains stable-core resource shutdown hooks", () => {
  assert.match(source, /stopTunnels: \(\) => \{ state\.hublotSupervisor\?\.stop\(\); return closeAllTunnels\(state\); \}/);
  assert.match(source, /stopRoutines: \(\) => stopAllRoutines\(state\)/);
});
