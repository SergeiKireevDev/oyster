# Per-File Server Code-Quality Loop

## Iteration prompt

Work on exactly one unchecked file from the checklist per iteration: the file named by the current checkbox. Read and review the entire file for correctness, security, error handling, resource cleanup, concurrency safety, performance, readability, duplication, dead code, API boundaries, testability, and maintainability. Fix every code-quality issue found in that file while preserving existing functional behavior whenever possible; do not make unrelated changes. Add or update focused tests when needed, then run those tests and the repository test suite (`npm test`). Check off the item only after the file has been fully reviewed, all identified issues have been resolved, and validation passes.

This exhaustive inventory includes every Git-tracked file under `server/` in the repository. Each checkbox is one loop-compatible work item.

## Server root

- [x] `server/application-candidate.mjs`
- [x] `server/app.mjs`
- [x] `server/checkpoints.mjs`
- [x] `server/pi-credential-service.mjs`
- [x] `server/pinned-widgets.mjs`
- [x] `server/pi-oauth-flow-service.mjs`
- [x] `server/pi-processes.mjs`
- [x] `server/reload-manifest.mjs`
- [x] `server/routines.mjs`
- [x] `server/runner-restart-service.mjs`
- [x] `server/runners.mjs`
- [x] `server/server.mjs`
- [x] `server/session-operations.mjs`
- [x] `server/session-references.mjs`
- [x] `server/sessions.mjs`
- [x] `server/session-titles.mjs`
- [x] `server/tunnels.mjs`

## HTTP infrastructure

- [x] `server/http/createRequestContext.mjs`
- [x] `server/http/createRouteTable.mjs`

## HTTP routes

- [x] `server/http/routes/checkpointRoutes.mjs`
- [x] `server/http/routes/credentialRoutes.mjs`
- [x] `server/http/routes/fileRoutes.mjs`
- [x] `server/http/routes/oauthRoutes.mjs`
- [x] `server/http/routes/openRoutes.mjs`
- [x] `server/http/routes/routineRoutes.mjs`
- [x] `server/http/routes/runnerRoutes.mjs`
- [x] `server/http/routes/sessionRoutes.mjs`
- [x] `server/http/routes/staticRoutes.mjs`
- [x] `server/http/routes/tunnelRoutes.mjs`
- [x] `server/http/routes/workdirRoutes.mjs`

## Persistence

- [x] `server/persistence/appSettings.mjs`
- [x] `server/persistence/appStore.mjs`
- [x] `server/persistence/checkpointImporter.mjs`
- [x] `server/persistence/checkpointRollbackJournal.mjs`
- [x] `server/persistence/hublotScriptMaterializer.mjs`
- [x] `server/persistence/hublotSupervisor.mjs`
- [x] `server/persistence/legacyBackup.mjs`
- [x] `server/persistence/legacyDataImport.mjs`
- [x] `server/persistence/legacyMigration.mjs`
- [x] `server/persistence/migrations.mjs`
- [x] `server/persistence/processIdentity.mjs`
- [x] `server/persistence/routineImporter.mjs`
- [ ] `server/persistence/routineMaterializer.mjs`
- [ ] `server/persistence/sessionDeletion.mjs`
- [ ] `server/persistence/sessionDeletionReconciler.mjs`
- [ ] `server/persistence/sessionOwners.mjs`
- [ ] `server/persistence/stateInventory.mjs`

## Session catalogs and search

- [ ] `server/sessions/jsonlCatalog.mjs`
- [ ] `server/sessions/searchQuery.mjs`
- [ ] `server/sessions/searchRescore.mjs`
- [ ] `server/sessions/sqliteCatalog.mjs`
- [ ] `server/sessions/usageAnalytics.mjs`
