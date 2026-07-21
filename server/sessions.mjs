/**
 * Backend-neutral saved-session catalog boundary.
 *
 * JSONL remains the active compatibility implementation until the configured
 * SQLite catalog is composed here. Consumers can migrate to `sessionCatalog`
 * without importing storage-layout details; named re-exports keep existing
 * JSONL callers stable during that migration.
 */
import { createJsonlSessionCatalog } from "./sessions/jsonlCatalog.mjs";

export * from "./sessions/jsonlCatalog.mjs";

export const sessionCatalog = createJsonlSessionCatalog();
