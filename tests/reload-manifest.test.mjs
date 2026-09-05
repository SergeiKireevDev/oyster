import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { RELOADABLE_MODULE_GRAPH, RELOADABLE_SERVER_MODULES } from "../server/reload-manifest.mjs";

const serverUrl = new URL("../server/", import.meta.url);

test("reload manifest names existing, unique server modules by dependency domain", () => {
  assert.deepEqual(Object.keys(RELOADABLE_MODULE_GRAPH), [
    "composition", "domain", "http", "persistence", "sessionPersistence",
  ]);
  assert.equal(Object.isFrozen(RELOADABLE_MODULE_GRAPH), true);
  assert.equal(Object.isFrozen(RELOADABLE_SERVER_MODULES), true);
  assert.ok(Object.values(RELOADABLE_MODULE_GRAPH).every(Object.isFrozen));
  assert.deepEqual(RELOADABLE_SERVER_MODULES, Object.values(RELOADABLE_MODULE_GRAPH).flat());
  assert.equal(new Set(RELOADABLE_SERVER_MODULES).size, RELOADABLE_SERVER_MODULES.length);
  for (const module of RELOADABLE_SERVER_MODULES) {
    assert.match(module, /\.mjs$/);
    assert.equal(
      module.startsWith("/") || module.includes("\\") || module.includes("..")
        || module.includes("?") || module.includes("#"),
      false,
      module,
    );
    assert.equal(existsSync(new URL(module, serverUrl)), true, module);
  }
});

test("reload manifest covers high-risk candidate boundaries and every route", () => {
  const required = [
    "app.mjs",
    "application-candidate.mjs",
    "runners.mjs",
    "tunnels.mjs",
    "routines.mjs",
    "checkpoints.mjs",
    "sessions.mjs",
    "sessions/jsonlCatalog.mjs",
    "sessions/sqliteCatalog.mjs",
    "persistence/checkpointRollbackJournal.mjs",
    "persistence/hublotSupervisor.mjs",
    "persistence/sessionDeletion.mjs",
  ];
  for (const module of required) assert.ok(RELOADABLE_SERVER_MODULES.includes(module), module);

  const expectedRoutes = [
    "checkpoint", "credential", "file", "mcp", "oauth", "open", "routine", "runner",
    "session", "static", "tunnel", "workdir",
  ].map((name) => `http/routes/${name}Routes.mjs`);
  assert.deepEqual(RELOADABLE_MODULE_GRAPH.http.filter((module) => module.includes("/routes/")), expectedRoutes);
});
