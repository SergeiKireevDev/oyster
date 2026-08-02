/**
 * Compatibility boundary for the JSONL session catalog.
 *
 * New backend-neutral consumers should use `sessionCatalog`; the explicit
 * re-exports preserve the legacy JSONL API without exposing future internal
 * helpers by accident. Backend selection belongs to the application
 * composition layer.
 */
import { createJsonlSessionCatalog } from "./sessions/jsonlCatalog.mjs";

export {
  SESSIONS_ROOT,
  createJsonlSessionCatalog,
  decodeFolderName,
  findSessionById,
  forkSessionAt,
  labelOf,
  listSessionFolders,
  listSessions,
  parseSessionFile,
  readSessionHeaderInfo,
  searchSessionFile,
  searchSessions,
  sessionDirFor,
  sessionEntries,
  sessionFileFromSearch,
  sessionFileNameParam,
  sessionFileParam,
  sessionMessages,
  sessionTree,
  summarizeSessionFile,
  textOf,
  transcriptMessage,
} from "./sessions/jsonlCatalog.mjs";

/** Shared, stateless JSONL adapter used by the default application backend. */
export const sessionCatalog = createJsonlSessionCatalog();
