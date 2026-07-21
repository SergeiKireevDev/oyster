import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../app.mjs", import.meta.url), "utf8");

test("app composes the extracted runner factory with explicit operations", () => {
  assert.match(appSource, /createRunnerRoutes\(\{[\s\S]*?state, requestContext, runnerFromReq, startRunner, listRunnerInfo,[\s\S]*?sessionFileParam, srvId, runnersChanged,[\s\S]*?\}\)/);
  assert.match(appSource, /createRouteTable\(\{[^}]*runner: runnerRoutes/);
});

test("app contains no extracted runner route bodies and retains lifecycle exports", () => {
  for (const route of [
    "GET /events",
    "POST /rpc",
    "GET /runners",
    "DELETE /runners",
    "POST /restart",
    "POST /open-session",
  ]) {
    assert.equal(appSource.includes(`"${route}":`), false, `stale runner route body: ${route}`);
  }
  assert.match(appSource, /return \{\s*handleRequest, startPi, stopPi,/);
});
