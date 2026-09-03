import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeTranscriptSink } from "../server/persistence/claudeTranscriptSink.mjs";
import { createSqliteSessionCatalog } from "../server/sessions/sqliteCatalog.mjs";

const PI_BIN = process.env.PI_BIN ?? new URL("../pi/packages/coding-agent/dist/cli.js", import.meta.url).pathname;

function record(type, uuid, content, timestamp) {
  return { type, uuid, timestamp, message: type === "assistant"
    ? { id: `msg-${uuid}`, model: "claude-sonnet", content, usage: { input_tokens: 2, output_tokens: 1 }, stop_reason: "end_turn" }
    : { role: "user", content } };
}

const line = (value) => `${JSON.stringify(value)}\n`;

// This integration test deliberately uses pi's repository package: the sink
// must update all coding-agent materializations rather than writing raw SQL.
test("Claude JSONL sink creates, incrementally updates, and rebuilds a pi SQLite session", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oyster-claude-sink-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectsDir = join(root, "projects");
  const nested = join(projectsDir, "-workspace");
  const sqlitePath = join(root, "sessions.sqlite");
  const sessionId = "12345678-1234-4234-8234-123456789abc";
  const sourcePath = join(nested, `${sessionId}.jsonl`);
  await mkdir(nested, { recursive: true });
  const user = record("user", "user-1", "hello", "2026-01-01T00:00:00.000Z");
  const assistant = record("assistant", "assistant-1", [{ type: "text", text: "hi" }], "2026-01-01T00:00:01.000Z");
  await writeFile(sourcePath, line(user) + line(assistant));

  const sink = createClaudeTranscriptSink({ projectsDir, sqlitePath, piBin: PI_BIN });
  const first = await sink.sync({ sessionId, cwd: join(root, "workspace") });
  assert.equal(first.found, true);
  assert.equal(first.changed, true);
  assert.equal(first.appended, 2);
  assert.deepEqual(first.reference, { backend: "sqlite", id: sessionId, storagePath: sqlitePath });

  const unchanged = await sink.sync({ sessionId, cwd: join(root, "workspace") });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.appended, 0);

  const next = record("user", "user-2", "continue", "2026-01-01T00:00:02.000Z");
  await appendFile(sourcePath, line(next));
  const appended = await sink.sync({ sessionId, cwd: join(root, "workspace") });
  assert.equal(appended.changed, true);
  assert.equal(appended.appended, 1);

  const catalog = createSqliteSessionCatalog({ databasePath: sqlitePath });
  t.after(() => catalog.close());
  let transcript = await catalog.messages(sessionId);
  assert.deepEqual(transcript.messages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.equal(transcript.messages[0].content[0].text, "hello");

  const corrected = { ...user, message: { role: "user", content: "corrected" } };
  await writeFile(sourcePath, line(corrected) + line(assistant) + line(next));
  const rebuilt = await sink.sync({ sessionId, cwd: join(root, "workspace") });
  assert.equal(rebuilt.changed, true);
  assert.equal(rebuilt.rebuilt, true);
  transcript = await catalog.messages(sessionId);
  assert.equal(transcript.messages[0].content[0].text, "corrected");
});

test("Claude JSONL sink tolerates missing transcripts and incomplete appended lines", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oyster-claude-sink-partial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectsDir = join(root, "projects");
  const sessionId = "87654321-4321-4321-8321-cba987654321";
  await mkdir(projectsDir, { recursive: true });
  const sink = createClaudeTranscriptSink({ projectsDir, sqlitePath: join(root, "sessions.sqlite"), piBin: PI_BIN });
  assert.deepEqual(await sink.sync({ sessionId, cwd: root }), {
    found: false, changed: false, sessionId, sourcePath: null, reference: null,
  });
  await writeFile(join(projectsDir, `${sessionId}.jsonl`), `${line(record("user", "user-1", "complete", "2026-01-01T00:00:00Z"))}{"type":"user"`);
  const result = await sink.sync({ sessionId, cwd: root });
  assert.equal(result.messageCount, 1);
  assert.equal(result.appended, 1);
});
