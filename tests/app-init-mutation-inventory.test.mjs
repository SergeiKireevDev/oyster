import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../server/app.mjs", import.meta.url), "utf8");
const inventory = readFileSync(new URL("../docs/development/hot-reload-lifecycle.md", import.meta.url), "utf8");

function directlyMutatedStateFields(source) {
  const fields = new Set();
  for (const match of source.matchAll(/\bstate\.([A-Za-z_$][\w$]*)\s*(?:=|\?\?=|\|\|=|&&=)/g)) fields.add(match[1]);
  for (const match of source.matchAll(/\bdelete\s+state\.([A-Za-z_$][\w$]*)/g)) fields.add(match[1]);
  return [...fields].sort();
}

const INVENTORIED_DIRECT_FIELDS = [
  "broadcast",
  "eventBuffer",
  "hublotSupervisor",
  "incompleteOperations",
  "oauthFlows",
  "piProcesses",
  "sessionCatalog",
  "sessionCatalogKey",
  "sessionDeletionReconciled",
  "sessionDeletionReconciliation",
  "sessionOperations",
  "sessionReferences",
].sort();

test("hot-reload lifecycle inventory defines every dependency ownership class", () => {
  for (const classification of ["stable", "candidate-owned", "shared-immutable", "restart-required"]) {
    assert.match(inventory, new RegExp(`\\*\\*${classification}\\*\\*`), `document ${classification} dependencies`);
  }
  assert.match(inventory, /candidate may call repositories but does\s+not own their SQLite connection/);
  assert.match(inventory, /Restart-required process dependencies are\s+intentionally not fields available to `app\.mjs`/);
});

test("hot-reload lifecycle inventory covers every direct init state mutation", () => {
  assert.deepEqual(directlyMutatedStateFields(appSource), INVENTORIED_DIRECT_FIELDS);
  for (const field of INVENTORIED_DIRECT_FIELDS) {
    assert.match(inventory, new RegExp(`\\bstate\\.${field}\\b`), `document state.${field}`);
  }
});

test("hot-reload lifecycle inventory covers delegated side-effect boundaries", () => {
  const delegatedCalls = [
    "reconcileSessionDeletions",
    "createRunnerManager",
    "scheduleHublotStartupReconciliation",
    "ensureHublotTunnelPool",
    "createPiProcessLauncher",
    "createSessionOperations",
    "createPiOAuthFlowService",
  ];
  for (const call of delegatedCalls) {
    assert.match(appSource, new RegExp(`\\b${call}\\(`), `${call} remains an init boundary`);
    assert.ok(inventory.includes(`${call}()`), `document delegated boundary ${call}()`);
  }

  for (const resource of [
    "state.sessionCatalog.close()",
    "state.runnerWatchdogTimer",
    "state.runnerReaperTimer",
    "state.hublotStartupReconciliationTask",
    "state.hublotProcessHandles",
    "readline `line`",
    "stderr `data`",
    "child `error`",
    "child `exit`",
    "stopTunnels()",
    "stopRoutines()",
    "stopOAuth()",
    "stopPi()",
  ]) {
    assert.ok(inventory.includes(resource), `document resource or cleanup path ${resource}`);
  }
  assert.match(inventory, /does \*\*not\*\* currently dispose the previous application/);
});
