import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { labelOf, textOf } from "./jsonlCatalog.mjs";

function decodeEntry(row) {
  let payload;
  try { payload = JSON.parse(row.payload); } catch { return null; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return { id: row.id, parentId: row.parent_id, type: row.type, timestamp: row.timestamp, ...payload };
}

function identityId(value) {
  const id = typeof value === "string" ? value : value?.id;
  if (!id) throw new Error("SQLite session ID is required");
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
  if (entry.type === "session_info" && entry.name) return [{ role: "meta", kind: "name", text: entry.name }];
  if (entry.type !== "message") return [];
  const message = entry.message ?? {};
  if (typeof message.content === "string") return [{ role: message.role, kind: "text", text: message.content }];
  if (!Array.isArray(message.content)) return [];
  const parts = [];
  for (const block of message.content) {
    if (block.type === "text" && block.text) parts.push({ role: message.role, kind: "text", text: block.text });
    else if (block.type === "thinking" && block.thinking) parts.push({ role: message.role, kind: "thinking", text: block.thinking });
    else if (block.type === "toolCall") parts.push({ role: message.role, kind: "toolCall", text: `${block.name} ${JSON.stringify(block.arguments ?? {})}` });
  }
  return parts;
}

/** Read-only catalog for the coding-agent SQLite session database. */
export function createSqliteSessionCatalog({ databasePath, databaseFactory = (path) => new DatabaseSync(path, { readOnly: true, timeout: 1000 }) }) {
  if (!databasePath) throw new Error("databasePath is required for the SQLite session catalog");
  const storagePath = resolve(databasePath);

  function withDatabase(operation, missingValue) {
    if (!existsSync(storagePath)) return missingValue;
    const database = databaseFactory(storagePath);
    try { return operation(database); } finally { database.close(); }
  }

  const summarySelect = `SELECT s.id, s.created_at, s.cwd, s.parent_session_id, s.active_leaf_id,
    COALESCE(s.updated_at, s.created_at) AS modified_at, s.first_message, s.all_messages_text,
    CASE WHEN json_valid(sm.payload) THEN json_extract(sm.payload, '$.name') END AS session_name,
    CASE WHEN json_valid(sm.payload) THEN json_extract(sm.payload, '$.messageCount') END AS message_count
    FROM sessions s LEFT JOIN session_materialized sm ON sm.session_id = s.id`;

  function rowSummary(row) {
    return {
      id: row.id,
      createdAt: row.created_at,
      modifiedAt: row.modified_at,
      name: row.session_name?.trim() || null,
      cwd: row.cwd,
      parentSessionId: row.parent_session_id ?? null,
      preview: row.first_message?.slice(0, 120) ?? null,
      messageCount: row.message_count ?? 0,
      storagePath,
    };
  }

  function list({ cwd } = {}) {
    return withDatabase((database) => {
      const rows = cwd
        ? database.prepare(`${summarySelect} WHERE s.cwd = ? ORDER BY modified_at DESC`).all(resolve(cwd))
        : database.prepare(`${summarySelect} ORDER BY modified_at DESC`).all();
      return rows.map(rowSummary);
    }, []);
  }

  function summarize(value) {
    const id = identityId(value);
    return withDatabase((database) => {
      const row = database.prepare(`${summarySelect} WHERE s.id = ?`).get(id);
      if (!row) throw new Error(`SQLite session not found: ${id}`);
      return rowSummary(row);
    }, null);
  }

  function findById(id) {
    return withDatabase((database) => {
      const row = database.prepare(`${summarySelect} WHERE s.id = ?`).get(id);
      return row ? rowSummary(row) : null;
    }, null);
  }

  function readHeader(value) {
    const summary = summarize(value);
    return summary ? {
      id: summary.id,
      cwd: summary.cwd,
      createdAt: summary.createdAt,
      parentSessionId: summary.parentSessionId,
      storagePath,
    } : null;
  }

  function readSession(value) {
    const id = identityId(value);
    return withDatabase((database) => {
      const session = database.prepare("SELECT id, cwd, created_at, parent_session_id, active_leaf_id FROM sessions WHERE id = ?").get(id);
      if (!session) throw new Error(`SQLite session not found: ${id}`);
      const rows = database.prepare(
        "SELECT id, parent_id, type, timestamp, payload FROM session_entries WHERE session_id = ? ORDER BY entry_seq",
      ).all(id);
      const allEntries = rows.map(decodeEntry).filter(Boolean);
      return { session, allEntries, byId: new Map(allEntries.map((entry) => [entry.id, entry])) };
    }, null);
  }

  function activeBranch(value) {
    const loaded = readSession(value);
    if (!loaded) return { session: null, allEntries: [], branch: [] };
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

  function entries(value) {
    const { session, branch } = activeBranch(value);
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

  function messages(value) {
    const { session, branch } = activeBranch(value);
    return {
      sessionId: session?.id ?? null,
      messages: branch.filter((entry) => entry.type === "message" && entry.message).map((entry) => entry.message),
    };
  }

  function tree(value) {
    const { session, allEntries } = readSession(value) ?? { session: null, allEntries: [] };
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

  function folders() {
    const counts = new Map();
    for (const session of list()) counts.set(session.cwd, (counts.get(session.cwd) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cwd, count]) => ({
      dir: cwd, name: cwd, label: cwd, count,
    }));
  }

  function search({ q, scope = "folder", path, cwd = path, includeTools = false }, maxResults = 200) {
    const query = q.toLowerCase();
    const selected = scope === "session" ? [findById(identityId(path))].filter(Boolean)
      : scope === "all" ? list() : list({ cwd });
    const results = [];
    let truncated = false;
    for (const session of selected) {
      const loaded = readSession(session.id);
      const hits = [];
      for (const entry of loaded.allEntries) {
        for (const part of searchableParts(entry)) {
          const isText = part.kind === "name" || (part.kind === "text" && ["user", "assistant"].includes(part.role));
          if (!includeTools && !isText) continue;
          const index = part.text.toLowerCase().indexOf(query);
          if (index < 0) continue;
          hits.push({
            entryId: entry.id ?? null,
            role: part.role ?? null,
            kind: part.kind,
            timestamp: entry.timestamp ?? null,
            snippet: snippet(part.text, index, query.length),
          });
          if (hits.length >= 25) break;
        }
        if (hits.length >= 25) break;
      }
      for (const hit of hits) {
        if (results.length >= maxResults) { truncated = true; break; }
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
    return { results, truncated, filesSearched: selected.length };
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
    close() {},
  });
}
