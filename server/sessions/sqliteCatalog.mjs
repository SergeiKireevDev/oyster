import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import sqlite3 from "sqlite3";
import { labelOf, transcriptMessage } from "./jsonlCatalog.mjs";
import { aggregateUsageRecords } from "./usageAnalytics.mjs";
import { rescoreSearchResults } from "./searchRescore.mjs";
const searchQueryUrl = new URL("./searchQuery.mjs", import.meta.url);
const { ftsSearchExpression, matchSearchText, parseSearchQuery } = await import(`${searchQueryUrl}?v=${statSync(searchQueryUrl).mtimeMs}`);

function decodeEntry(row) {
  let payload;
  try { payload = JSON.parse(row.payload); } catch { return null; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (typeof row.id !== "string" || !row.id || typeof row.type !== "string" || !row.type) return null;
  // Structural fields are stored separately and must not be overridable by a
  // malformed or hand-edited payload.
  return {
    ...payload,
    id: row.id,
    parentId: typeof row.parent_id === "string" && row.parent_id ? row.parent_id : null,
    type: row.type,
    timestamp: row.timestamp,
  };
}

function identityId(value) {
  const id = typeof value === "string" ? value : value?.id;
  if (typeof id !== "string" || !id) throw new Error("SQLite session ID is required");
  return id;
}

function snippet(text, index, length, context = 70) {
  const start = Math.max(0, index - context);
  const end = Math.min(text.length, index + length + context);
  return {
    before: `${start ? "…" : ""}${text.slice(start, index).replace(/\s+/g, " ")}`,
    match: text.slice(index, index + length),
    after: `${text.slice(index + length, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`,
  };
}

function searchableParts(entry) {
  if (entry.type === "session_info" && typeof entry.name === "string" && entry.name) {
    return [{ role: "meta", kind: "name", text: entry.name }];
  }
  if (entry.type !== "message" || !entry.message || typeof entry.message !== "object") return [];
  const message = entry.message;
  if (typeof message.content === "string") return [{ role: message.role, kind: "text", text: message.content }];
  if (!Array.isArray(message.content)) return [];
  const parts = [];
  for (const block of message.content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string" && block.text) {
      parts.push({ role: message.role, kind: "text", text: block.text });
    } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
      parts.push({ role: message.role, kind: "thinking", text: block.thinking });
    } else if (block.type === "toolCall") {
      const name = typeof block.name === "string" && block.name ? block.name : "?";
      parts.push({ role: message.role, kind: "toolCall", text: `${name} ${JSON.stringify(block.arguments ?? {})}` });
    }
  }
  return parts;
}

function openAsyncDatabase(path) {
  return new Promise((resolvePromise, reject) => {
    const database = new sqlite3.Database(path, sqlite3.OPEN_READONLY, (error) => {
      if (error) reject(error);
      else {
        database.configure("busyTimeout", 1000);
        resolvePromise(database);
      }
    });
  });
}

function databaseGet(database, sql, ...params) {
  return new Promise((resolvePromise, reject) => database.get(sql, params, (error, row) => {
    if (error) reject(error); else resolvePromise(row);
  }));
}

function databaseAll(database, sql, ...params) {
  return new Promise((resolvePromise, reject) => database.all(sql, params, (error, rows) => {
    if (error) reject(error); else resolvePromise(rows);
  }));
}

function normalizeDatabase(database) {
  if (database && typeof database.prepare === "function" && typeof database.get !== "function") {
    const synchronous = database;
    return Object.freeze({
      get: (sql, params, callback) => {
        try { callback(null, synchronous.prepare(sql).get(...params)); } catch (error) { callback(error); }
      },
      all: (sql, params, callback) => {
        try { callback(null, synchronous.prepare(sql).all(...params)); } catch (error) { callback(error); }
      },
      close: (callback) => {
        try { synchronous.close(); callback(); } catch (error) { callback(error); }
      },
    });
  }
  return database;
}

function closeAsyncDatabase(database) {
  return new Promise((resolvePromise, reject) => database.close((error) => error ? reject(error) : resolvePromise()));
}

/** Read-only catalog for the coding-agent SQLite session database. */
export function createSqliteSessionCatalog({
  databasePath,
  databaseFactory = openAsyncDatabase,
} = {}) {
  if (!databasePath) throw new Error("databasePath is required for the SQLite session catalog");
  const storagePath = resolve(databasePath);

  async function withDatabase(operation, missingValue) {
    if (!existsSync(storagePath)) return missingValue;
    const database = normalizeDatabase(await databaseFactory(storagePath));
    let operationError = null;
    try {
      return await operation(database);
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try { await closeAsyncDatabase(database); }
      catch (closeError) { if (!operationError) throw closeError; }
    }
  }

  const summarySelect = `SELECT s.id, s.created_at, s.cwd, s.parent_session_id, s.active_leaf_id,
    COALESCE(s.updated_at, s.created_at) AS modified_at, s.first_message, s.all_messages_text,
    CASE WHEN json_valid(sm.payload) THEN json_extract(sm.payload, '$.name') END AS session_name,
    CASE WHEN json_valid(sm.payload) THEN json_extract(sm.payload, '$.messageCount') END AS message_count
    FROM sessions s LEFT JOIN session_materialized sm ON sm.session_id = s.id`;

  function rowSummary(row) {
    const name = typeof row.session_name === "string" ? row.session_name.trim() : "";
    return {
      id: row.id,
      createdAt: row.created_at,
      modifiedAt: row.modified_at,
      name: name || null,
      cwd: typeof row.cwd === "string" ? row.cwd : null,
      parentSessionId: typeof row.parent_session_id === "string" ? row.parent_session_id : null,
      preview: typeof row.first_message === "string" ? row.first_message.slice(0, 120) : null,
      messageCount: Number.isSafeInteger(row.message_count) && row.message_count >= 0 ? row.message_count : 0,
      storagePath,
    };
  }

  async function list({ cwd } = {}) {
    return withDatabase(async (database) => {
      const rows = cwd
        ? await databaseAll(database, `${summarySelect} WHERE s.cwd = ? ORDER BY modified_at DESC`, resolve(cwd))
        : await databaseAll(database, `${summarySelect} ORDER BY modified_at DESC`);
      return rows.map(rowSummary);
    }, []);
  }

  async function summarize(value) {
    const id = identityId(value);
    return withDatabase(async (database) => {
      const row = await databaseGet(database, `${summarySelect} WHERE s.id = ?`, id);
      if (!row) throw new Error(`SQLite session not found: ${id}`);
      return rowSummary(row);
    }, null);
  }

  async function findById(id) {
    return withDatabase(async (database) => {
      const row = await databaseGet(database, `${summarySelect} WHERE s.id = ?`, id);
      return row ? rowSummary(row) : null;
    }, null);
  }

  async function readHeader(value) {
    const summary = await summarize(value);
    return summary ? {
      id: summary.id,
      cwd: summary.cwd,
      createdAt: summary.createdAt,
      parentSessionId: summary.parentSessionId,
      storagePath,
    } : null;
  }

  async function readSessionFromDatabase(database, id) {
    const session = await databaseGet(database,
      "SELECT id, cwd, created_at, parent_session_id, active_leaf_id FROM sessions WHERE id = ?", id);
    if (!session) throw new Error(`SQLite session not found: ${id}`);
    const rows = await databaseAll(database,
      "SELECT id, parent_id, type, timestamp, payload FROM session_entries WHERE session_id = ? ORDER BY entry_seq", id);
    const allEntries = rows.map(decodeEntry).filter(Boolean);
    return { session, allEntries, byId: new Map(allEntries.map((entry) => [entry.id, entry])) };
  }

  async function readSession(value) {
    const id = identityId(value);
    return withDatabase((database) => readSessionFromDatabase(database, id), null);
  }

  function activeBranchFromLoaded(loaded) {
    const branch = [];
    const seen = new Set();
    let entry = loaded.session.active_leaf_id ? loaded.byId.get(loaded.session.active_leaf_id) : null;
    while (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      branch.push(entry);
      entry = entry.parentId ? loaded.byId.get(entry.parentId) : null;
    }
    branch.reverse();
    return { ...loaded, branch };
  }

  async function activeBranch(value) {
    const loaded = await readSession(value);
    return loaded ? activeBranchFromLoaded(loaded) : { session: null, allEntries: [], branch: [] };
  }

  async function entries(value) {
    const { session, branch } = await activeBranch(value);
    return {
      sessionId: session?.id ?? null,
      leafId: session?.active_leaf_id ?? null,
      entries: branch
        .filter((entry) => entry.type === "message" && ["user", "assistant"].includes(entry.message?.role))
        .map((entry) => ({
          id: entry.id,
          role: entry.message.role,
          text: (labelOf(entry.message) ?? "").slice(0, 200),
          timestamp: entry.timestamp ?? null,
        })),
    };
  }

  async function messages(value) {
    const id = identityId(value);
    return withDatabase(async (database) => {
      const session = await databaseGet(database,
        "SELECT id, active_leaf_id FROM sessions WHERE id = ?", id);
      if (!session) throw new Error(`SQLite session not found: ${id}`);
      const rows = await databaseAll(database,
        "SELECT id, parent_id, type, timestamp, payload FROM session_entries WHERE session_id = ? ORDER BY entry_seq", id);
      const allEntries = rows.map(decodeEntry).filter(Boolean);
      const loaded = { session, allEntries, byId: new Map(allEntries.map((entry) => [entry.id, entry])) };
      const { branch } = activeBranchFromLoaded(loaded);
      return {
        sessionId: session.id,
        messages: branch.map(transcriptMessage).filter(Boolean),
      };
    }, { sessionId: null, messages: [] });
  }

  async function tree(value) {
    const { session, allEntries } = await readSession(value) ?? { session: null, allEntries: [] };
    return {
      session: session ? { id: session.id, timestamp: session.created_at, cwd: session.cwd } : null,
      nodes: allEntries.filter((entry) => entry.type !== "leaf").map((entry) => {
        let label = entry.type;
        let role = null;
        if (entry.type === "message") {
          role = entry.message?.role ?? null;
          label = (labelOf(entry.message) ?? "").slice(0, 200);
        } else if (entry.type === "model_change") label = `model → ${entry.modelId ?? "?"}`;
        else if (entry.type === "thinking_level_change") label = `thinking → ${entry.thinkingLevel ?? "?"}`;
        else if (entry.type === "session_info") label = `named: ${entry.name ?? ""}`;
        return { id: entry.id, parentId: entry.parentId ?? null, type: entry.type, timestamp: entry.timestamp ?? null, role, label };
      }),
    };
  }

  async function folders() {
    const counts = new Map();
    for (const session of await list()) {
      if (session.cwd !== null) counts.set(session.cwd, (counts.get(session.cwd) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cwd, count]) => ({
      dir: cwd, name: cwd, label: cwd, count,
    }));
  }

  async function search({ q, scope = "folder", path, cwd = path, includeTools = false } = {}, maxResults = 200) {
    const { terms, operator } = parseSearchQuery(q);
    if (!terms.length) return { results: [], truncated: false, filesSearched: 0 };
    const selected = scope === "session" ? [await findById(identityId(path))].filter(Boolean)
      : scope === "all" ? await list() : await list({ cwd });
    const filesSearched = selected.length;
    const resultLimit = Number.isSafeInteger(maxResults) && maxResults >= 0 ? maxResults : 0;
    const searched = await withDatabase(async (database) => {
      let candidates = selected;
      let indexedEntries = null;
      // Pi's FTS index uses the trigram tokenizer. Terms shorter than three
      // characters cannot be represented by MATCH, so scan in that case to
      // preserve the catalog's quoted-short-term search behavior.
      const canUseSearchIndex = terms.every((term) => [...term].length >= 3);
      const hasSearchIndex = canUseSearchIndex && await databaseGet(database,
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'session_search_fts'");
      if (hasSearchIndex) {
        const searchableFilter = includeTools
          ? ""
          : "AND (f.kind = 'name' OR (f.kind = 'text' AND f.role IN ('user', 'assistant')))";
        const rows = await databaseAll(database, `
          SELECT DISTINCT f.session_id, f.entry_id
          FROM session_search_fts f
          WHERE session_search_fts MATCH ? ${searchableFilter}
        `, ftsSearchExpression(terms, operator));
        indexedEntries = new Map();
        for (const row of rows) {
          if (!indexedEntries.has(row.session_id)) indexedEntries.set(row.session_id, new Set());
          indexedEntries.get(row.session_id).add(row.entry_id);
        }
        candidates = selected.filter((session) => indexedEntries.has(session.id));
      }

      const results = [];
      let truncated = false;
      for (const session of candidates) {
        const loaded = activeBranchFromLoaded(await readSessionFromDatabase(database, session.id));
        const hits = [];
        for (const entry of loaded.branch) {
          if (indexedEntries && !indexedEntries.get(session.id)?.has(entry.id)) continue;
          for (const part of searchableParts(entry)) {
            const isText = part.kind === "name" || (part.kind === "text" && ["user", "assistant"].includes(part.role));
            if (!includeTools && !isText) continue;
            const match = matchSearchText(part.text, terms, operator);
            if (!match) continue;
            hits.push({
              entryId: entry.id ?? null,
              role: part.role ?? null,
              kind: part.kind,
              timestamp: entry.timestamp ?? null,
              snippet: snippet(part.text, match.index, match.length),
            });
            if (hits.length >= 25) break;
          }
          if (hits.length >= 25) break;
        }
        for (const hit of hits) {
          if (results.length >= resultLimit) { truncated = true; break; }
          results.push({
            ...hit,
            sessionId: session.id,
            sessionName: session.name,
            sessionPreview: session.preview,
            sessionCwd: session.cwd,
            folder: session.cwd,
            folderLabel: session.cwd,
          });
        }
        if (truncated) break;
      }
      return { results, truncated };
    }, { results: [], truncated: false });
    return { results: rescoreSearchResults(searched.results, q), truncated: searched.truncated, filesSearched };
  }

  async function usageAnalytics({ bucket = "day", since = null } = {}) {
    return withDatabase(async (database) => {
      const rows = since
        ? await databaseAll(database, `SELECT session_id, id, timestamp, payload FROM session_entries WHERE type = 'message' AND timestamp >= ? ORDER BY timestamp`, since)
        : await databaseAll(database, "SELECT session_id, id, timestamp, payload FROM session_entries WHERE type = 'message' ORDER BY timestamp");
      const records = rows.flatMap((row) => {
        try {
          const payload = JSON.parse(row.payload);
          return payload?.message?.role === "assistant"
            ? [{ sessionId: row.session_id, entryId: row.id, timestamp: row.timestamp, message: payload.message }]
            : [];
        } catch { return []; }
      });
      return aggregateUsageRecords(records, { bucket });
    }, { bucket, total: {}, models: [], series: [] });
  }

  return Object.freeze({
    backend: "sqlite",
    root: dirname(storagePath),
    storagePath,
    locationForCwd: (cwd) => resolve(cwd),
    list,
    folders,
    summarize,
    findById,
    readHeader,
    entries,
    messages,
    tree,
    search,
    usageAnalytics,
    close() {},
  });
}
