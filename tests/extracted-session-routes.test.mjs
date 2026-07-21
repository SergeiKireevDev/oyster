import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../app.mjs", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../http/routes/sessionRoutes.mjs", import.meta.url), "utf8");

test("app composes session routes with explicit domain dependencies", () => {
  assert.match(appSource, /createSessionRoutes\(\{[\s\S]*?sessions: \{[\s\S]*?catalog: state\.sessionCatalog,[\s\S]*?sessionTargetFromSearch,[\s\S]*?runners: \{ stopRunner, runnersChanged \},[\s\S]*?resources: \{ closeTunnel, stopSessionRoutines, deleteSessionRoutines \},[\s\S]*?deleteOwnedSession,[\s\S]*?\}\)/);
  assert.match(appSource, /createRouteTable\(\{[^}]*session: sessionRoutes/);
  assert.equal(routeSource.includes('from "../../app.mjs"'), false);
  assert.equal(routeSource.includes('from "../app.mjs"'), false);
});

test("app contains no extracted session route handler bodies", () => {
  for (const route of [
    "GET /sessions",
    "DELETE /session",
    "GET /session-by-id",
    "GET /session-entries",
    "GET /session-messages",
    "GET /session-folders",
    "GET /search",
  ]) {
    assert.equal(appSource.includes(`"${route}":`), false, `stale session route body: ${route}`);
  }
});
