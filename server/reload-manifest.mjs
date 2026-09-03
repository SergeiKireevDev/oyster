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
function createReloadManifest(groups) {
  const seen = new Map();
  const modules = [];
  const graph = {};

  for (const [group, entries] of Object.entries(groups)) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new TypeError(`reloadable module group "${group}" must be a non-empty array`);
    }

    const frozenEntries = entries.map((module) => {
      if (
        typeof module !== "string"
        || !module.endsWith(".mjs")
        || module.startsWith("/")
        || module.includes("\\")
        || module.includes("?")
        || module.includes("#")
        || module.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
      ) {
        throw new TypeError(`invalid reloadable server module in "${group}": ${String(module)}`);
      }

      const previousGroup = seen.get(module);
      if (seen.has(module)) {
        throw new Error(
          `duplicate reloadable server module "${module}" in "${previousGroup}" and "${group}"`,
        );
      }
      seen.set(module, group);
      modules.push(module);
      return module;
    });

    graph[group] = Object.freeze(frozenEntries);
  }

  return Object.freeze({
    graph: Object.freeze(graph),
    modules: Object.freeze(modules),
  });
}

const manifest = createReloadManifest({
  composition: [
    "app.mjs",
    "application-candidate.mjs",
  ],
  domain: [
    "checkpoints.mjs",
    "pi-credential-service.mjs",
    "pi-oauth-flow-service.mjs",
    "pi-processes.mjs",
    "pinned-widgets.mjs",
    "routines.mjs",
    "runner-restart-service.mjs",
    "runner-drivers/claude-code.mjs",
    "runner-drivers/claude-transcript.mjs",
    "runner-drivers/configured.mjs",
    "runner-drivers/contract.mjs",
    "runner-drivers/pi-rpc.mjs",
    "runner-drivers/registry.mjs",
    "runners.mjs",
    "session-operations.mjs",
    "session-references.mjs",
    "sessions.mjs",
    "session-titles.mjs",
    "tunnels.mjs",
  ],
  http: [
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
  ],
  persistence: [
    "persistence/checkpointRollbackJournal.mjs",
    "persistence/claudeTranscriptSink.mjs",
    "persistence/hublotScriptMaterializer.mjs",
    "persistence/hublotSupervisor.mjs",
    "persistence/processIdentity.mjs",
    "persistence/routineMaterializer.mjs",
    "persistence/sessionDeletion.mjs",
    "persistence/sessionDeletionReconciler.mjs",
    "persistence/sessionOwners.mjs",
  ],
  sessionPersistence: [
    "sessions/jsonlCatalog.mjs",
    "sessions/searchQuery.mjs",
    "sessions/searchRescore.mjs",
    "sessions/sqliteCatalog.mjs",
    "sessions/usageAnalytics.mjs",
  ],
});

export const RELOADABLE_MODULE_GRAPH = manifest.graph;
export const RELOADABLE_SERVER_MODULES = manifest.modules;
