import { existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Backend mutations delegated to the selected pi implementation. */
export function createSessionOperations({
  config,
  sessionReferences,
  unlinkFile = unlinkSync,
  loadSqliteRepository,
} = {}) {
  const repositoryModulePath = join(dirname(config.PI_BIN), "core", "sqlite-session-repository.js");
  const sqliteDeleteSupported = typeof loadSqliteRepository === "function" || existsSync(repositoryModulePath);

  async function repositoryClass() {
    try {
      const Repository = loadSqliteRepository
        ? await loadSqliteRepository()
        : (await import(pathToFileURL(repositoryModulePath).href)).CodingAgentSqliteSessionRepository;
      if (typeof Repository === "function") return Repository;
    } catch (cause) {
      const error = new Error(`configured pi cannot load SQLite session operations: ${repositoryModulePath}`, { cause });
      error.code = "capability_unavailable";
      throw error;
    }
    const error = new Error(`configured pi does not expose SQLite session operations: ${repositoryModulePath}`);
    error.code = "capability_unavailable";
    throw error;
  }

  async function deleteSession(input) {
    const reference = sessionReferences.validate(input);
    if (reference.backend === "jsonl") {
      unlinkFile(reference.storagePath);
      return { backend: "jsonl", id: reference.id, deleted: reference.storagePath };
    }
    if (!sqliteDeleteSupported) {
      const error = new Error("configured pi does not support SQLite session deletion");
      error.code = "capability_unavailable";
      throw error;
    }
    const Repository = await repositoryClass();
    const repository = new Repository(reference.storagePath);
    await repository.deleteById(reference.id);
    return { backend: "sqlite", id: reference.id, deleted: sessionReferences.serialize(reference) };
  }

  return Object.freeze({
    capabilities: Object.freeze({ delete: Object.freeze({ jsonl: true, sqlite: sqliteDeleteSupported }) }),
    deleteSession,
  });
}
