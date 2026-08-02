/**
 * oyster — session file access
 *
 * The single home for reading pi's session .jsonl files. Every consumer
 * (listing, search, tree views, permalink anchors, forking, checkpoints)
 * goes through ONE parser, `parseSessionFile`, backed by an mtime-keyed LRU
 * cache — so repeated /sessions, /search and checkpoint lookups don't
 * re-read and re-parse every file on each request (these used to be
 * synchronous full-folder scans on the hot path, stalling the event loop
 * and every SSE stream with it).
 *
 * pi stores sessions per working directory:
 *   ~/.pi/agent/sessions/--<cwd with separators mapped to "-">--/<ts>_<id>.jsonl
 * Each file is a header line ({ type: "session", id, cwd, parentSession, … })
 * followed by tree entries (id/parentId), so forked conversations form real
 * branches; the file's last entry is the tip of the active branch.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { rescoreSearchResults } from "./searchRescore.mjs";
const searchQueryUrl = new URL("./searchQuery.mjs", import.meta.url);
const { matchSearchText, parseSearchQuery } = await import(`${searchQueryUrl}?v=${statSync(searchQueryUrl).mtimeMs}`);

export const SESSIONS_ROOT = join(homedir(), ".pi", "agent", "sessions");

export function sessionDirFor(cwd) {
  const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(SESSIONS_ROOT, safePath);
}

function resolvedSessionFile(target) {
  try {
    const root = realpathSync(SESSIONS_ROOT);
    const canonical = realpathSync(target);
    const fromRoot = relative(root, canonical);
    if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || resolve(root, fromRoot) !== canonical) return null;
    return statSync(canonical).isFile() ? canonical : null;
  } catch {
    return null;
  }
}

export function sessionFileParam(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || !value.endsWith(".jsonl")) return null;
  return resolvedSessionFile(resolve(SESSIONS_ROOT, value));
}

export function sessionFileNameParam(raw) {
  const file = typeof raw === "string" ? raw.trim() : "";
  if (!file || file !== basename(file) || !file.endsWith(".jsonl")) return null;
  try {
    for (const folder of readdirSync(SESSIONS_ROOT, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      const target = resolvedSessionFile(join(SESSIONS_ROOT, folder.name, file));
      if (target) return target;
    }
  } catch {}
  return null;
}

export function sessionFileFromSearch(url) {
  return sessionFileParam(url.searchParams.get("path")) || sessionFileNameParam(url.searchParams.get("file"));
}

/** best-effort human-readable name for a session folder like
 *  "--home-alice-my-project--" -> "/home/alice/my/project" (lossy for dashes) */
export function decodeFolderName(name) {
  return "/" + name.replace(/^--/, "").replace(/--$/, "").replace(/-/g, "/");
}

function directoryEntries(directory) {
  try { return readdirSync(directory, { withFileTypes: true }); } catch { return []; }
}

function jsonlFileNames(directory) {
  return directoryEntries(directory)
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name);
}

function sessionFolderEntries() {
  return directoryEntries(SESSIONS_ROOT).filter((entry) => entry.isDirectory());
}

// ---------------------------------------------------------------- parse cache

const CACHE_MAX = 100; // parsed files kept in memory (LRU)
const cache = new Map(); // path -> { mtimeMs, size, parsed }

/**
 * Parse a session .jsonl once per (path, mtime, size).
 * Returns { header, name, entries, byId }:
 *   header  – the { type: "session" } line (first one wins), or null
 *   name    – last session_info name seen, or null
 *   entries – every non-header entry in file order (unparseable lines skipped)
 *   byId    – Map of the id-bearing entries
 * Throws if the file cannot be read (callers decide how to degrade).
 */
export function parseSessionFile(path) {
  const st = statSync(path);
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    cache.delete(path);
    cache.set(path, hit); // LRU bump
    return hit.parsed;
  }
  const text = readFileSync(path, "utf8");
  let header = null;
  let name = null;
  const entries = [];
  const byId = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    if (e.type === "session") { header ??= e; continue; }
    if (e.type === "session_info" && typeof e.name === "string") name = e.name;
    entries.push(e);
    if (typeof e.id === "string" && e.id) byId.set(e.id, e);
  }
  const parsed = { header, name, entries, byId };
  cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, parsed });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return parsed;
}

// ---------------------------------------------------------------- text extraction

/** first text block of a message's content (string or block array) */
export function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content.find((block) => block?.type === "text")?.text;
  return typeof text === "string" ? text : null;
}

/** short display label for a message: its text, else a tool/thinking marker */
export function labelOf(message) {
  const c = message?.content;
  let t = textOf(c);
  if (!t && Array.isArray(c)) {
    const tc = c.find((b) => b?.type === "toolCall");
    if (tc) t = `[tool: ${tc.name ?? "?"}]`;
    else if (c.find((b) => b?.type === "toolResult") || message?.role === "toolResult") t = "[tool result]";
    else if (c.find((b) => b?.type === "thinking")) t = "[thinking]";
  }
  return t;
}

/** Pull searchable text blocks out of one entry. */
function entryTexts(e) {
  const out = [];
  if (e.type === "message") {
    const m = e.message ?? {};
    const c = m.content;
    if (typeof c === "string") out.push({ role: m.role, kind: "text", text: c });
    else if (Array.isArray(c)) {
      for (const b of c) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "text" && typeof b.text === "string" && b.text) out.push({ role: m.role, kind: "text", text: b.text });
        else if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking) out.push({ role: m.role, kind: "thinking", text: b.thinking });
        else if (b.type === "toolCall") {
          let argumentsText = "{}";
          try { argumentsText = JSON.stringify(b.arguments ?? {}) ?? "{}"; } catch { argumentsText = "[unserializable arguments]"; }
          out.push({ role: m.role, kind: "toolCall", text: `${b.name ?? "?"} ${argumentsText}` });
        }
      }
    }
  } else if (e.type === "session_info" && e.name) {
    out.push({ role: "meta", kind: "name", text: e.name });
  }
  return out;
}

// ---------------------------------------------------------------- summaries & listing

export function summarizeSessionFile(path) {
  const { header, name, entries } = parseSessionFile(path);
  let firstUserText = null;
  let messageCount = 0;
  for (const e of entries) {
    if (e.type !== "message") continue;
    const m = e.message;
    if (m?.role === "user" || m?.role === "assistant") messageCount++;
    if (!firstUserText && m?.role === "user") firstUserText = textOf(m.content);
  }
  return {
    id: header?.id ?? null,
    createdAt: header?.timestamp ?? null,
    name,
    cwd: header?.cwd ?? null,
    parentSession: header?.parentSession ?? null,
    preview: firstUserText?.slice(0, 120) ?? null,
    messageCount,
  };
}

export function listSessions(dir) {
  if (!existsSync(dir)) return [];
  const sessions = [];
  for (const file of jsonlFileNames(dir)) {
    const path = join(dir, file);
    try {
      const summary = summarizeSessionFile(path);
      sessions.push({ path, modifiedAt: statSync(path).mtime.toISOString(), ...summary });
    } catch (e) {
      console.error(`[oyster] failed to read session ${file}: ${e.message}`);
    }
  }
  sessions.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return sessions;
}

export function listSessionFolders() {
  return sessionFolderEntries()
    .map((e) => {
      const count = jsonlFileNames(join(SESSIONS_ROOT, e.name)).length;
      return { dir: join(SESSIONS_ROOT, e.name), name: e.name, label: decodeFolderName(e.name), count };
    })
    .filter((f) => f.count > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** header + name of one session file, or null if it has no session header */
export function readSessionHeaderInfo(path) {
  const { header, name } = parseSessionFile(path);
  if (!header?.id) return null;
  return {
    path,
    id: header.id,
    name,
    cwd: header.cwd ?? null,
    createdAt: header.timestamp ?? null,
    parentSession: header.parentSession ?? null,
    forkedAtHash: header.forkedAtHash ?? null,
  };
}

/** Locate a session .jsonl file from its session id, across every folder.
 *  Fast path: files are named <timestamp>_<id>.jsonl; fall back to reading
 *  each file's session header. */
export function findSessionById(id) {
  if (typeof id !== "string" || !id) return null;
  const folders = sessionFolderEntries().map((entry) => join(SESSIONS_ROOT, entry.name));
  for (const dir of folders) {
    for (const f of jsonlFileNames(dir)) {
      if (!f.endsWith(`_${id}.jsonl`) && f !== `${id}.jsonl`) continue;
      const path = join(dir, f);
      try { if (parseSessionFile(path).header?.id === id) return path; } catch {}
    }
  }
  for (const dir of folders) {
    for (const f of jsonlFileNames(dir)) {
      const path = join(dir, f);
      try {
        if (parseSessionFile(path).header?.id === id) return path;
      } catch {}
    }
  }
  return null;
}

// ---------------------------------------------------------------- search

function makeSnippet(text, idx, qLen, ctx = 70) {
  const start = Math.max(0, idx - ctx);
  const end = Math.min(text.length, idx + qLen + ctx);
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, idx).replace(/\s+/g, " "),
    match: text.slice(idx, idx + qLen),
    after: text.slice(idx + qLen, end).replace(/\s+/g, " ") + (end < text.length ? "…" : ""),
  };
}

export function searchSessionFile(path, query, maxHitsPerFile = 25, includeTools = false) {
  const parsedQuery = Array.isArray(query) ? { terms: query, operator: "AND" }
    : query && typeof query === "object" ? query : parseSearchQuery(query);
  const terms = Array.isArray(parsedQuery.terms)
    ? parsedQuery.terms.filter((term) => typeof term === "string" && term)
    : [];
  const operator = parsedQuery.operator === "OR" ? "OR" : "AND";
  const hitLimit = Number.isSafeInteger(maxHitsPerFile) && maxHitsPerFile > 0 ? maxHitsPerFile : 0;
  if (!terms.length || !hitLimit) return [];
  let parsed;
  try { parsed = parseSessionFile(path); } catch { return []; }
  const { header, name, entries, byId } = parsed;
  let leafId = null;
  for (const entry of entries) if (typeof entry.id === "string" && entry.id) leafId = entry.id;
  const activeEntries = [];
  const seen = new Set();
  for (let entry = leafId ? byId.get(leafId) : null; entry && !seen.has(entry.id); entry = entry.parentId ? byId.get(entry.parentId) : null) {
    seen.add(entry.id);
    activeEntries.push(entry);
  }
  activeEntries.reverse();
  const activeIds = new Set(activeEntries.map((entry) => entry.id));
  const searchableEntries = entries.filter((entry) => entry.type === "session_info" || activeIds.has(entry.id));
  const meta = { id: header?.id ?? null, name, preview: null, cwd: header?.cwd ?? null };
  const hits = [];
  outer: for (const e of searchableEntries) {
    for (const t of entryTexts(e)) {
      if (!meta.preview && t.role === "user" && t.kind === "text") meta.preview = t.text.slice(0, 120);
      // default: only real text responses (user/assistant) and session
      // names; tool calls, tool RESULTS (role toolResult, kind text) and
      // thinking blocks are opt-in
      const isTextResponse = t.kind === "name" ||
        (t.kind === "text" && (t.role === "user" || t.role === "assistant"));
      if (!includeTools && !isTextResponse) continue;
      const match = matchSearchText(t.text, terms, operator);
      if (!match) continue;
      hits.push({
        entryId: e.id ?? null,
        role: t.role ?? null,
        kind: t.kind,
        timestamp: e.timestamp ?? null,
        snippet: makeSnippet(t.text, match.index, match.length),
      });
      if (hits.length >= hitLimit) break outer;
    }
  }
  return hits.map((h) => ({ ...h, sessionMeta: meta }));
}

/**
 * scope:
 *   session -> path = a session .jsonl file
 *   folder  -> path = a folder under SESSIONS_ROOT (default: defaultDir)
 *   all     -> every folder under SESSIONS_ROOT
 */
export function searchSessions({ q, scope, path, includeTools = false, defaultDir = null } = {}, maxResults = 200) {
  const parsedQuery = parseSearchQuery(q);
  const { terms } = parsedQuery;
  if (!terms.length) return { results: [], truncated: false, filesSearched: 0 };
  const resultLimit = Number.isSafeInteger(maxResults) && maxResults >= 0 ? maxResults : 0;
  const files = [];
  if (scope === "session") {
    if (typeof path === "string" && path) files.push(path);
  } else {
    const dirs = scope === "all"
      ? listSessionFolders().map((f) => f.dir)
      : [path || defaultDir];
    for (const dir of dirs) {
      if (!dir || !existsSync(dir)) continue;
      for (const f of jsonlFileNames(dir)) files.push(join(dir, f));
    }
  }
  // newest first
  files.sort().reverse();
  const results = [];
  let truncated = false;
  for (const file of files) {
    const hits = searchSessionFile(file, parsedQuery, 25, includeTools);
    if (!hits.length) continue;
    const folderName = basename(dirname(file));
    for (const h of hits) {
      if (results.length >= resultLimit) { truncated = true; break; }
      const { sessionMeta, ...rest } = h;
      results.push({
        ...rest,
        sessionPath: file,
        sessionId: sessionMeta.id,
        sessionName: sessionMeta.name,
        sessionPreview: sessionMeta.preview,
        sessionCwd: sessionMeta.cwd,
        folder: folderName,
        folderLabel: decodeFolderName(folderName),
      });
    }
    if (truncated) break;
  }
  return { results: rescoreSearchResults(results, q), truncated, filesSearched: files.length };
}

// ---------------------------------------------------------------- tree views

/** Parse a session .jsonl into tree nodes. Every entry has id/parentId, so
 *  forked conversations form real branches. */
export function sessionTree(path) {
  const { header, entries } = parseSessionFile(path);
  const nodes = [];
  for (const e of entries) {
    if (typeof e.id !== "string" || !e.id) continue;
    const node = {
      id: e.id,
      parentId: e.parentId ?? null,
      type: e.type,
      timestamp: e.timestamp ?? null,
      role: null,
      label: null,
    };
    if (e.type === "message") {
      const m = e.message ?? {};
      node.role = m.role ?? null;
      node.label = (labelOf(m) ?? "").slice(0, 200);
    } else if (e.type === "model_change") {
      node.label = `model → ${e.modelId ?? "?"}`;
    } else if (e.type === "thinking_level_change") {
      node.label = `thinking → ${e.thinkingLevel ?? "?"}`;
    } else if (e.type === "session_info") {
      node.label = `named: ${e.name ?? ""}`;
    } else {
      node.label = e.type;
    }
    nodes.push(node);
  }
  return {
    session: header ? { id: header.id, timestamp: header.timestamp, cwd: header.cwd } : null,
    nodes,
  };
}

/** Ordered user/assistant message entries of a session's ACTIVE branch
 *  (the chain from the last entry up to the root). These entry ids are the
 *  stable anchors used by message permalinks: the client zips them against
 *  its rendered transcript. */
export function sessionEntries(path) {
  const { header, entries, byId } = parseSessionFile(path);
  let leafId = null;
  for (const e of entries) if (typeof e.id === "string" && e.id) leafId = e.id;
  const chain = [];
  const seen = new Set();
  for (let cur = leafId ? byId.get(leafId) : null; cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : null) {
    seen.add(cur.id);
    chain.push(cur);
  }
  chain.reverse();
  const out = [];
  for (const e of chain) {
    if (e.type !== "message") continue;
    const m = e.message ?? {};
    if (m.role !== "user" && m.role !== "assistant") continue;
    out.push({ id: e.id, role: m.role, text: (labelOf(m) ?? "").slice(0, 200), timestamp: e.timestamp ?? null });
  }
  return { sessionId: header?.id ?? null, leafId, entries: out };
}

/** Full message objects of the ACTIVE branch, in order — the same shape
 *  pi's get_messages returns. Lets the UI render a transcript straight from
 *  the (cached) file while the pi process is still spawning/resuming. */
export function transcriptMessage(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.type === "message" && entry.message && typeof entry.message === "object") {
    return { ...entry.message, entryTimestamp: entry.timestamp ?? null };
  }
  if (entry.type === "compaction") {
    return {
      role: "compactionSummary",
      summary: entry.summary ?? "",
      tokensBefore: entry.tokensBefore ?? 0,
      timestamp: new Date(entry.timestamp).getTime(),
    };
  }
  return null;
}

export function sessionMessages(path) {
  const { header, entries, byId } = parseSessionFile(path);
  let leafId = null;
  for (const e of entries) if (typeof e.id === "string" && e.id) leafId = e.id;
  const chain = [];
  const seen = new Set();
  for (let cur = leafId ? byId.get(leafId) : null; cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : null) {
    seen.add(cur.id);
    chain.push(cur);
  }
  chain.reverse();
  return {
    sessionId: header?.id ?? null,
    messages: chain.map(transcriptMessage).filter(Boolean),
  };
}

// ---------------------------------------------------------------- forking

/** Deterministic session fork: copy the active-branch chain up to `leafId`
 *  into a new .jsonl (same entry ids, parentSession lineage) — the same
 *  shape pi's own /fork produces, minus any LLM involvement. */
export function forkSessionAt(sessionPath, leafId, forkedAtHash = null) {
  const { header, byId } = parseSessionFile(sessionPath);
  if (!header) throw new Error("session header missing");
  if (typeof leafId !== "string" || !byId.has(leafId)) throw new Error(`entry ${leafId} not found in session`);
  const chain = [];
  const seen = new Set();
  for (let cur = byId.get(leafId); cur; cur = cur.parentId ? byId.get(cur.parentId) : null) {
    if (seen.has(cur.id)) throw new Error(`cycle detected at entry ${cur.id}`);
    seen.add(cur.id);
    chain.push(cur);
  }
  chain.reverse();
  const id = randomUUID();
  const now = new Date();
  const newHeader = { ...header, id, timestamp: now.toISOString(), parentSession: sessionPath,
    ...(forkedAtHash ? { forkedAtHash } : {}) }; // extra field: pi ignores it, the tree view uses it
  const path = join(dirname(sessionPath), `${now.toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`);
  writeFileSync(path, [newHeader, ...chain].map((e) => JSON.stringify(e)).join("\n") + "\n", { flag: "wx" });
  return { path, id, entryIds: new Set(chain.map((e) => e.id)) };
}

/** Backend-neutral read contract implemented by the legacy JSONL store. */
export function createJsonlSessionCatalog() {
  return Object.freeze({
    backend: "jsonl",
    root: SESSIONS_ROOT,
    locationForCwd: sessionDirFor,
    list: ({ cwd, location } = {}) => listSessions(location ?? sessionDirFor(cwd ?? process.cwd())),
    folders: listSessionFolders,
    summarize: summarizeSessionFile,
    findById(id) {
      const path = findSessionById(id);
      return path ? { path, ...summarizeSessionFile(path) } : null;
    },
    readHeader: readSessionHeaderInfo,
    entries: sessionEntries,
    messages: sessionMessages,
    tree: sessionTree,
    search: searchSessions,
    resolvePath: sessionFileParam,
    resolveFromSearch: sessionFileFromSearch,
    close() {},
  });
}
