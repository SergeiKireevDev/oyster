/**
 * Fixture tests for sessions.mjs (parsing, cache, branches, forking, search).
 *
 * sessions.mjs derives SESSIONS_ROOT from homedir() at import time, so HOME
 * is pointed at a temp dir BEFORE the module is imported (each test file
 * runs in its own process under `node --test`).
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FAKE_HOME = mkdtempSync(join(tmpdir(), "pi-ui-test-home-"));
process.env.HOME = FAKE_HOME;

const {
  SESSIONS_ROOT, sessionDirFor, decodeFolderName, parseSessionFile,
  textOf, labelOf, summarizeSessionFile, listSessions, listSessionFolders,
  readSessionHeaderInfo, findSessionById, searchSessions, searchSessionFile,
  sessionTree, sessionEntries, sessionMessages, forkSessionAt,
} = await import("../sessions.mjs");

after(() => rmSync(FAKE_HOME, { recursive: true, force: true }));

// ---------------------------------------------------------------- fixtures

const FOLDER = join(SESSIONS_ROOT, "--home-user-proj--");

/** A session with a fork inside the entry tree:
 *    u1 -> a1 -> u2 -> a2      (abandoned branch)
 *            \-> u3 -> a3      (active branch: written later = file tail)
 */
function fixtureLines() {
  return [
    { type: "session", id: "sess-1", timestamp: "2026-01-01T00:00:00Z", cwd: "/home/user/proj" },
    { type: "message", id: "u1", parentId: null, timestamp: "t1", message: { role: "user", content: "hello world" } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "t2", message: { role: "assistant", content: [{ type: "thinking", thinking: "pondering deeply" }, { type: "text", text: "hi there" }] } },
    { type: "message", id: "u2", parentId: "a1", timestamp: "t3", message: { role: "user", content: "abandoned path" } },
    { type: "message", id: "a2", parentId: "u2", timestamp: "t4", message: { role: "assistant", content: [{ type: "toolCall", name: "Bash", arguments: { command: "ls -la" } }] } },
    { type: "session_info", id: "n1", parentId: "a2", name: "my session" },
    { type: "message", id: "u3", parentId: "a1", timestamp: "t5", message: { role: "user", content: "take the other path" } },
    { type: "message", id: "a3", parentId: "u3", timestamp: "t6", message: { role: "assistant", content: [{ type: "text", text: "done via other path" }] } },
  ];
}

function writeSession(file, lines) {
  mkdirSync(FOLDER, { recursive: true });
  const path = join(FOLDER, file);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

const MAIN = writeSession("2026-01-01T00-00-00-000Z_sess-1.jsonl", fixtureLines());

// ---------------------------------------------------------------- naming helpers

test("sessionDirFor maps cwd separators", () => {
  assert.equal(sessionDirFor("/home/user/proj"), FOLDER);
});

test("decodeFolderName round-trips simple paths", () => {
  assert.equal(decodeFolderName("--home-user-proj--"), "/home/user/proj");
});

// ---------------------------------------------------------------- parsing & cache

test("parseSessionFile: header, name, entries, byId", () => {
  const p = parseSessionFile(MAIN);
  assert.equal(p.header.id, "sess-1");
  assert.equal(p.name, "my session");
  assert.equal(p.entries.length, 7); // everything except the header
  assert.ok(p.byId.has("a3"));
});

test("parseSessionFile: skips unparseable lines, tolerates missing header", () => {
  const path = writeSession("broken.jsonl", []);
  writeFileSync(path, 'not json\n{"type":"message","id":"x","parentId":null,"message":{"role":"user","content":"ok"}}\n');
  const p = parseSessionFile(path);
  assert.equal(p.header, null);
  assert.equal(p.entries.length, 1);
});

test("parseSessionFile: cache hit returns same object, mtime change invalidates", () => {
  const a = parseSessionFile(MAIN);
  const b = parseSessionFile(MAIN);
  assert.equal(a, b); // identity = cache hit
  // simulate an external append (mtime/size change)
  writeFileSync(MAIN, JSON.stringify(fixtureLines()[0]) + "\n");
  writeFileSync(MAIN, fixtureLines().map((l) => JSON.stringify(l)).join("\n") + "\n");
  utimesSync(MAIN, new Date(), new Date(Date.now() + 5000));
  const c = parseSessionFile(MAIN);
  assert.notEqual(a, c);
  assert.equal(c.header.id, "sess-1");
});

// ---------------------------------------------------------------- text extraction

test("textOf handles string and block content", () => {
  assert.equal(textOf("plain"), "plain");
  assert.equal(textOf([{ type: "text", text: "block" }]), "block");
  assert.equal(textOf([{ type: "thinking", thinking: "x" }]), null);
});

test("labelOf falls back to tool/thinking markers", () => {
  assert.equal(labelOf({ content: [{ type: "toolCall", name: "Bash" }] }), "[tool: Bash]");
  assert.equal(labelOf({ content: [{ type: "thinking", thinking: "x" }] }), "[thinking]");
  assert.equal(labelOf({ content: "hi" }), "hi");
});

// ---------------------------------------------------------------- summaries

test("summarizeSessionFile counts messages and previews first user text", () => {
  const s = summarizeSessionFile(MAIN);
  assert.equal(s.id, "sess-1");
  assert.equal(s.name, "my session");
  assert.equal(s.cwd, "/home/user/proj");
  assert.equal(s.preview, "hello world");
  assert.equal(s.messageCount, 6); // u1 a1 u2 a2 u3 a3
});

test("listSessions returns newest-first with paths", () => {
  const list = listSessions(FOLDER);
  assert.ok(list.length >= 1);
  assert.ok(list.every((s) => s.path.startsWith(FOLDER)));
});

test("listSessionFolders finds the fixture folder", () => {
  const folders = listSessionFolders();
  assert.ok(folders.some((f) => f.dir === FOLDER && f.count >= 1));
});

test("readSessionHeaderInfo / findSessionById", () => {
  const info = readSessionHeaderInfo(MAIN);
  assert.equal(info.id, "sess-1");
  assert.equal(info.parentSession, null);
  assert.equal(findSessionById("sess-1"), MAIN);
  assert.equal(findSessionById("nope"), null);
});

// ---------------------------------------------------------------- branches

test("sessionEntries follows the ACTIVE branch (file tail up to root)", () => {
  const { sessionId, leafId, entries } = sessionEntries(MAIN);
  assert.equal(sessionId, "sess-1");
  assert.equal(leafId, "a3");
  // active branch is u1 -> a1 -> u3 -> a3 (u2/a2 belong to the abandoned one)
  assert.deepEqual(entries.map((e) => e.id), ["u1", "a1", "u3", "a3"]);
  assert.equal(entries[3].text, "done via other path");
});

test("sessionMessages returns full message objects of the active branch", () => {
  const { sessionId, messages } = sessionMessages(MAIN);
  assert.equal(sessionId, "sess-1");
  // active branch only (u2/a2 abandoned), full objects incl. content blocks
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(messages[0].content, "hello world");
  assert.equal(messages[3].content[0].text, "done via other path");
});

test("sessionTree exposes both branches with parent links", () => {
  const { session, nodes } = sessionTree(MAIN);
  assert.equal(session.id, "sess-1");
  const byId = new Map(nodes.map((n) => [n.id, n]));
  assert.equal(byId.get("u2").parentId, "a1");
  assert.equal(byId.get("u3").parentId, "a1"); // sibling = real branch
  assert.equal(byId.get("a2").label, "[tool: Bash]");
  assert.equal(byId.get("n1").label, "named: my session");
});

// ---------------------------------------------------------------- forking

test("forkSessionAt copies the chain, sets lineage, keeps entry ids", () => {
  const fork = forkSessionAt(MAIN, "a1", "abc123");
  const p = parseSessionFile(fork.path);
  assert.notEqual(p.header.id, "sess-1");
  assert.equal(p.header.parentSession, MAIN);
  assert.equal(p.header.forkedAtHash, "abc123");
  assert.deepEqual(p.entries.map((e) => e.id), ["u1", "a1"]);
  assert.deepEqual([...fork.entryIds], ["u1", "a1"]);
  // and the fork is discoverable by its id
  assert.equal(findSessionById(fork.id), fork.path);
  rmSync(fork.path);
});

test("forkSessionAt rejects unknown leaf ids", () => {
  assert.throws(() => forkSessionAt(MAIN, "nope"), /not found/);
});

// ---------------------------------------------------------------- search

test("search finds user/assistant text but not tools by default", () => {
  const r1 = searchSessions({ q: "other path", scope: "folder", path: FOLDER });
  assert.ok(r1.results.length >= 2); // u3 and a3
  assert.ok(r1.results.every((h) => ["user", "assistant"].includes(h.role)));

  const r2 = searchSessions({ q: "ls -la", scope: "folder", path: FOLDER });
  assert.equal(r2.results.length, 0); // tool call hidden by default

  const r3 = searchSessions({ q: "ls -la", scope: "folder", path: FOLDER, includeTools: true });
  assert.equal(r3.results[0].kind, "toolCall");

  const r4 = searchSessions({ q: "pondering", scope: "folder", path: FOLDER, includeTools: true });
  assert.equal(r4.results[0].kind, "thinking");
});

test("search matches session names and builds snippets", () => {
  const hits = searchSessionFile(MAIN, "my session");
  assert.equal(hits[0].kind, "name");
  const [h] = searchSessionFile(MAIN, "world");
  assert.equal(h.snippet.match, "world");
  assert.equal(h.snippet.before, "hello ");
  assert.equal(h.sessionMeta.id, "sess-1");
});

test("search scope=session and scope=all agree on the fixture", () => {
  const a = searchSessions({ q: "hello", scope: "session", path: MAIN });
  const b = searchSessions({ q: "hello", scope: "all" });
  assert.equal(a.results.length, 1);
  assert.ok(b.results.some((h) => h.sessionPath === MAIN));
});
