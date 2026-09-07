import { resolve } from "node:path";
import { defaultRepositoryFactory } from "./claudeTranscriptSink.mjs";

const HARNESSES = new Set(["codex", "gemini", "amp"]);

/** Append canonical native-driver messages through Pi's SQLite repository.
 * Entry IDs are allocated by the driver before queuing, making retries idempotent.
 * Native IDs are retained for CLI resume; metadata guards against cross-harness collisions.
 */
export function createNativeTranscriptSink({ sqlitePath, piBin, repositoryFactory = defaultRepositoryFactory } = {}) {
  if (typeof sqlitePath !== "string" || !sqlitePath) throw new TypeError("SQLite path is required");
  const databasePath = resolve(sqlitePath);
  const pending = new Map();
  let repositoryPromise;
  const repository = () => repositoryPromise ??= Promise.resolve(repositoryFactory({ sqlitePath: databasePath, piBin }));

  async function append({ harness, sessionId, cwd, name, entries }) {
    const repo = await repository();
    let session;
    try {
      try { session = await repo.openById(sessionId); }
      catch (error) {
        if (error?.code !== "not_found" && !/not found/i.test(String(error?.message))) throw error;
        session = await repo.create({ id: sessionId, cwd, metadata: { harness, externalSessionId: sessionId } });
      }
      const metadata = await session.getMetadata();
      if (metadata.metadata?.harness !== harness || metadata.metadata?.externalSessionId !== sessionId) {
        throw new Error(`Refusing to overwrite another harness's session: ${sessionId}`);
      }
      let appended = 0;
      for (const { id, message } of entries) {
        if (await session.getEntry(id)) continue;
        const timestamp = Number.isFinite(message.timestamp) ? message.timestamp : Date.now();
        await session.getStorage().appendEntry({
          type: "message", id, parentId: await session.getStorage().getLeafId(),
          timestamp: new Date(timestamp).toISOString(), message,
        });
        appended++;
      }
      if (name && await session.getSessionName() !== name) await session.appendSessionName(name);
      return { appended, reference: { backend: "sqlite", id: sessionId, storagePath: databasePath } };
    } finally { await session?.close(); }
  }

  return Object.freeze({
    append(options) {
      if (!HARNESSES.has(options?.harness) || typeof options?.sessionId !== "string" || !options.sessionId
          || typeof options.cwd !== "string" || !Array.isArray(options.entries)) throw new TypeError("invalid native transcript batch");
      // Snapshot immediately: driver objects may continue streaming while a write is queued.
      const snapshot = structuredClone(options);
      const key = options.sessionId;
      const operation = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(() => append(snapshot));
      pending.set(key, operation);
      return operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); });
    },
    async flush() { await Promise.all([...pending.values()]); },
  });
}
