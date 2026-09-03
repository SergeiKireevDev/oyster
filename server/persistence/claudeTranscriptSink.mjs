import { existsSync, realpathSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { claudeRecordsToSessionEntries, parseClaudeJsonl } from "../runner-drivers/claude-transcript.mjs";

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function repositoryModuleCandidates(piBin) {
  const executable = realpathSync(requiredString(piBin, "pi executable"));
  const dist = dirname(executable);
  return [
    join(dist, "core", "sqlite-session-repository.js"),
    join(dist, "..", "dist", "core", "sqlite-session-repository.js"),
  ];
}

async function defaultRepositoryFactory({ piBin, sqlitePath }) {
  const modulePath = repositoryModuleCandidates(piBin).find((candidate) => existsSync(candidate));
  if (!modulePath) throw new Error(`cannot locate pi SQLite repository beside ${piBin}`);
  const { CodingAgentSqliteSessionRepository } = await import(pathToFileURL(modulePath).href);
  return new CodingAgentSqliteSessionRepository(sqlitePath);
}

async function findNamedFile(root, name) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === name) return join(root, entry.name);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findNamedFile(join(root, entry.name), name);
    if (found) return found;
  }
  return null;
}

function sameEntry(left, right) {
  return left?.type === right?.type
    && left?.id === right?.id
    && left?.parentId === right?.parentId
    && JSON.stringify(left?.message) === JSON.stringify(right?.message);
}

/**
 * Reconcile Claude's append-only JSONL transcript into pi's SQLite session
 * repository. JSONL is read in full on every sync; unchanged records are
 * skipped, appended records are added, and rewritten transcripts are rebuilt.
 */
export function createClaudeTranscriptSink({
  projectsDir,
  sqlitePath,
  piBin,
  repositoryFactory = defaultRepositoryFactory,
  readFileImpl = readFile,
  statImpl = stat,
  findFile = findNamedFile,
} = {}) {
  const root = resolve(requiredString(projectsDir, "Claude projects directory"));
  const databasePath = resolve(requiredString(sqlitePath, "SQLite path"));
  requiredString(piBin, "pi executable");
  if (typeof repositoryFactory !== "function") throw new TypeError("repositoryFactory must be a function");
  const paths = new Map();
  const pending = new Map();
  let repositoryPromise = null;

  const repository = () => repositoryPromise ??= Promise.resolve(repositoryFactory({ piBin, sqlitePath: databasePath }));

  async function sourcePath(sessionId) {
    const cached = paths.get(sessionId);
    if (cached) {
      try {
        const info = await statImpl(cached);
        if (info.isFile()) return cached;
      } catch {}
      paths.delete(sessionId);
    }
    const found = await findFile(root, `${sessionId}.jsonl`);
    if (found) paths.set(sessionId, found);
    return found;
  }

  async function reconcile({ sessionId, cwd }) {
    const id = requiredString(sessionId, "Claude session id");
    const workdir = resolve(requiredString(cwd, "Claude session cwd"));
    const path = await sourcePath(id);
    if (!path) return { found: false, changed: false, sessionId: id, sourcePath: null, reference: null };
    const entries = claudeRecordsToSessionEntries(parseClaudeJsonl(await readFileImpl(path, "utf8")));
    const repo = await repository();
    let session = null;
    let created = false;
    try {
      session = await repo.openById(id);
    } catch (error) {
      if (error?.code !== "not_found" && !/not found/i.test(String(error?.message))) throw error;
      session = await repo.create({ cwd: workdir, id, metadata: { harness: "claude-code", externalSessionId: id, importedFrom: path } });
      created = true;
    }

    let existing = await session.getEntries();
    const persistedMessages = existing.filter((entry) => entry.type === "message");
    const commonLength = Math.min(persistedMessages.length, entries.length);
    let prefixMatches = persistedMessages.length <= entries.length;
    for (let index = 0; prefixMatches && index < commonLength; index++) {
      if (!sameEntry(persistedMessages[index], entries[index])) prefixMatches = false;
    }
    if (!prefixMatches) {
      await session.close();
      session = null;
      await repo.deleteById(id);
      session = await repo.create({ cwd: workdir, id, metadata: { harness: "claude-code", externalSessionId: id, importedFrom: path } });
      existing = [];
      created = true;
    }

    const knownIds = new Set(existing.map((entry) => entry.id));
    let appended = 0;
    for (const entry of entries) {
      if (knownIds.has(entry.id)) continue;
      await session.getStorage().appendEntry(entry);
      knownIds.add(entry.id);
      appended++;
    }
    await session.close();
    session = null;
    return {
      found: true,
      changed: created || appended > 0,
      rebuilt: created && persistedMessages.length > 0,
      appended,
      messageCount: entries.length,
      sessionId: id,
      sourcePath: path,
      reference: { backend: "sqlite", id, storagePath: databasePath },
    };
  }

  return Object.freeze({
    root,
    sqlitePath: databasePath,
    sync(options) {
      const id = requiredString(options?.sessionId, "Claude session id");
      const previous = pending.get(id) ?? Promise.resolve();
      const operation = previous.catch(() => {}).then(() => reconcile(options));
      pending.set(id, operation);
      return operation.finally(() => { if (pending.get(id) === operation) pending.delete(id); });
    },
  });
}

export { findNamedFile, repositoryModuleCandidates };
