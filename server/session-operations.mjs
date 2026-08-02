import { realpathSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Backend mutations delegated to the selected pi implementation. */
export function createSessionOperations({
  config,
  sessionReferences,
  unlinkFile = unlinkSync,
  loadSqliteRepository,
} = {}) {
  if (typeof config?.PI_BIN !== "string" || !config.PI_BIN) {
    throw new TypeError("config.PI_BIN is required for session operations");
  }
  if (typeof sessionReferences?.validate !== "function" || typeof sessionReferences?.serialize !== "function") {
    throw new TypeError("sessionReferences must provide validate and serialize methods");
  }
  if (typeof unlinkFile !== "function") throw new TypeError("unlinkFile must be a function");
  if (loadSqliteRepository !== undefined && typeof loadSqliteRepository !== "function") {
    throw new TypeError("loadSqliteRepository must be a function");
  }

  let resolvedPiBin = config.PI_BIN;
  try {
    resolvedPiBin = realpathSync(config.PI_BIN);
  } catch {
    // Preserve the configured path so unsupported installations report a capability failure.
  }
  const repositoryModulePath = join(dirname(resolvedPiBin), "core", "sqlite-session-repository.js");
  let repositoryModuleExists = false;
  try {
    repositoryModuleExists = statSync(repositoryModulePath).isFile();
  } catch {
    // Missing, inaccessible, and otherwise unusable paths do not provide the capability.
  }
  const sqliteDeleteSupported = loadSqliteRepository !== undefined || repositoryModuleExists;
  let repositoryClassPromise;

  function capabilityError(message, cause) {
    const error = new Error(message, cause === undefined ? undefined : { cause });
    error.code = "capability_unavailable";
    return error;
  }

  async function repositoryClass() {
    if (!repositoryClassPromise) {
      repositoryClassPromise = (async () => {
        const Repository = loadSqliteRepository
          ? await loadSqliteRepository()
          : (await import(pathToFileURL(repositoryModulePath).href)).CodingAgentSqliteSessionRepository;
        if (typeof Repository !== "function") {
          throw capabilityError(`configured pi does not expose SQLite session operations: ${repositoryModulePath}`);
        }
        return Repository;
      })();
    }
    const pending = repositoryClassPromise;
    try {
      return await pending;
    } catch (cause) {
      // A transient loader failure must not disable all future operations.
      if (repositoryClassPromise === pending) repositoryClassPromise = undefined;
      if (cause?.code === "capability_unavailable") throw cause;
      throw capabilityError(`configured pi cannot load SQLite session operations: ${repositoryModulePath}`, cause);
    }
  }

  async function deleteSession(input) {
    const reference = sessionReferences.validate(input);
    if (reference.backend === "jsonl") {
      await unlinkFile(reference.storagePath);
      return { backend: "jsonl", id: reference.id, deleted: reference.storagePath };
    }
    if (!sqliteDeleteSupported) {
      throw capabilityError("configured pi does not support SQLite session deletion");
    }
    const Repository = await repositoryClass();
    const repository = new Repository(reference.storagePath);
    await repository.deleteById(reference.id);
    return { backend: "sqlite", id: reference.id, deleted: sessionReferences.serialize(reference) };
  }

  async function forkSession(input, { entryId, cwd, id } = {}) {
    const reference = sessionReferences.validate(input);
    if (reference.backend !== "sqlite") throw new Error("exact repository fork is only used for SQLite sessions");
    if (!sqliteDeleteSupported) {
      throw capabilityError("configured pi does not support exact-entry SQLite forks");
    }
    const Repository = await repositoryClass();
    const repository = new Repository(reference.storagePath);
    const fork = await repository.fork(reference.id, { cwd, id, entryId, position: "at" });
    if (!fork || typeof fork.close !== "function") {
      throw capabilityError("configured pi returned an invalid SQLite fork session");
    }
    let operationError;
    try {
      if (typeof fork.getMetadata !== "function") {
        throw capabilityError("configured pi returned an invalid SQLite fork session");
      }
      const metadata = await fork.getMetadata();
      return {
        id: metadata.id,
        sessionRef: sessionReferences.validate({ backend: "sqlite", id: metadata.id, storagePath: reference.storagePath }),
      };
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try {
        await fork.close();
      } catch (closeError) {
        if (!operationError) throw closeError;
        throw new AggregateError([operationError, closeError], "SQLite fork operation and cleanup both failed", {
          cause: operationError,
        });
      }
    }
  }

  return Object.freeze({
    capabilities: Object.freeze({
      delete: Object.freeze({ jsonl: true, sqlite: sqliteDeleteSupported }),
      exactFork: Object.freeze({ jsonl: true, sqlite: sqliteDeleteSupported }),
    }),
    deleteSession,
    forkSession,
  });
}
