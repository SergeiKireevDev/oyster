/**
 * Explicit dependency graph for modules that are safe to rebuild as one
 * transactional application candidate. Paths are relative to server/.
 *
 * Keep stable-core modules out of this graph: merely watching a module claims
 * that a successful candidate can replace its behavior without a process
 * restart. Transitive modules are listed as well as composition entry points so
 * edits to runners, tunnels, routines, checkpoints, sessions, and persistence
 * adapters all schedule a candidate build.
 */
export const RELOADABLE_MODULE_GRAPH = Object.freeze({
  composition: Object.freeze([
    "app.mjs",
    "application-candidate.mjs",
  ]),
  domain: Object.freeze([
    "checkpoints.mjs",
    "pi-credential-service.mjs",
    "pi-oauth-flow-service.mjs",
    "pi-processes.mjs",
    "pinned-widgets.mjs",
    "routines.mjs",
    "runner-restart-service.mjs",
    "runners.mjs",
    "session-operations.mjs",
    "session-references.mjs",
    "sessions.mjs",
    "session-titles.mjs",
    "tunnels.mjs",
  ]),
  http: Object.freeze([
    "http/createRequestContext.mjs",
    "http/createRouteTable.mjs",
    "http/routes/checkpointRoutes.mjs",
    "http/routes/credentialRoutes.mjs",
    "http/routes/fileRoutes.mjs",
    "http/routes/oauthRoutes.mjs",
    "http/routes/openRoutes.mjs",
    "http/routes/routineRoutes.mjs",
    "http/routes/runnerRoutes.mjs",
    "http/routes/sessionRoutes.mjs",
    "http/routes/staticRoutes.mjs",
    "http/routes/tunnelRoutes.mjs",
    "http/routes/workdirRoutes.mjs",
  ]),
  persistence: Object.freeze([
    "persistence/checkpointRollbackJournal.mjs",
    "persistence/hublotScriptMaterializer.mjs",
    "persistence/hublotSupervisor.mjs",
    "persistence/processIdentity.mjs",
    "persistence/routineMaterializer.mjs",
    "persistence/sessionDeletion.mjs",
    "persistence/sessionDeletionReconciler.mjs",
    "persistence/sessionOwners.mjs",
  ]),
  sessionPersistence: Object.freeze([
    "sessions/jsonlCatalog.mjs",
    "sessions/searchQuery.mjs",
    "sessions/searchRescore.mjs",
    "sessions/sqliteCatalog.mjs",
    "sessions/usageAnalytics.mjs",
  ]),
});

export const RELOADABLE_SERVER_MODULES = Object.freeze(
  Object.values(RELOADABLE_MODULE_GRAPH).flat(),
);

const duplicates = RELOADABLE_SERVER_MODULES.filter(
  (module, index, modules) => modules.indexOf(module) !== index,
);
if (duplicates.length) throw new Error(`duplicate reloadable server module: ${duplicates.join(", ")}`);
