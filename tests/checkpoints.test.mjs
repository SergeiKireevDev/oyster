/**
 * Fixture tests for checkpoints.mjs: store atomicity/quarantine, anchoring,
 * the checkpoint-tree inheritance rules, and the real git checkpoint flow
 * (against a throwaway repo — git is a hard dependency of the feature).
 *
 * HOME is pointed at a temp dir BEFORE importing, so the store and the
 * sessions root both live under the fixture (each test file is its own
 * process under `node --test`).
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FAKE_HOME = mkdtempSync(join(tmpdir(), "pi-ui-test-home-"));
process.env.HOME = FAKE_HOME;

const { SESSIONS_ROOT } = await import("../sessions.mjs");
const {
  recordCheckpoint: recordCheckpointCore, checkpointTree: checkpointTreeCore, git, checkpointWorkdir,
} = await import("../checkpoints.mjs");

let checkpointRows = {};
const repository = {
  listForSession: (reference) => checkpointRows[reference.id] ?? [],
  record(reference, checkpoint) {
    const list = (checkpointRows[reference.id] ??= []);
    const existing = list.find((item) => item.hash === checkpoint.hash && item.anchorId === checkpoint.anchorId);
    if (existing) return existing;
    list.push(checkpoint);
    return checkpoint;
  },
};
const clearCheckpoints = () => { checkpointRows = {}; };
const saveCheckpoints = (rows) => { checkpointRows = structuredClone(rows); };
const recordCheckpoint = (session, dir, result, options = {}) => recordCheckpointCore(session, dir, result, { ...options, repository });
const checkpointTree = (session, options = {}) => checkpointTreeCore(session, { ...options, repository });

after(() => rmSync(FAKE_HOME, { recursive: true, force: true }));

// ---------------------------------------------------------------- session fixtures

const FOLDER = join(SESSIONS_ROOT, "--home-user-proj--");
mkdirSync(FOLDER, { recursive: true });

function writeSession(file, header, entries) {
  const path = join(FOLDER, file);
  writeFileSync(path, [header, ...entries].map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

const mainEntries = [
  { type: "message", id: "u1", parentId: null, message: { role: "user", content: "one" } },
  { type: "message", id: "a1", parentId: "u1", message: { role: "assistant", content: "two" } },
  { type: "message", id: "u2", parentId: "a1", message: { role: "user", content: "three" } },
];
const MAIN = writeSession("2026-01-01T00-00-00-000Z_root.jsonl",
  { type: "session", id: "root", timestamp: "2026-01-01T00:00:00Z", cwd: "/home/user/proj" },
  mainEntries);

// ---------------------------------------------------------------- store

// ---------------------------------------------------------------- anchoring

test("recordCheckpoint anchors to the session tip and dedupes", () => {
  clearCheckpoints();
  const rec = recordCheckpoint(MAIN, "/home/user/proj", { hash: "abc1234", message: "checkpoint: x" });
  assert.equal(rec.anchorId, "u2"); // last user/assistant message
  assert.equal(rec.leafId, "u2");
  assert.equal(rec.sessionPath, MAIN);
  const again = recordCheckpoint(MAIN, "/home/user/proj", { hash: "abc1234", message: "checkpoint: x" });
  assert.equal(checkpointRows.root.length, 1, "same hash@anchor recorded once");
  assert.equal(again.timestamp, rec.timestamp);
});

test("recordCheckpoint refuses sessions without messages", () => {
  const empty = writeSession("2026-01-02T00-00-00-000Z_empty.jsonl",
    { type: "session", id: "empty", timestamp: "2026-01-02T00:00:00Z", cwd: "/x" }, []);
  assert.equal(recordCheckpoint(empty, "/x", { hash: "h" }), null);
  rmSync(empty);
});

// ---------------------------------------------------------------- tree inheritance

test("checkpointTree: forks nest under the root, inherited checkpoints shown once", () => {
  clearCheckpoints();
  // root has two checkpoints; fork was created from cp1 and adds its own cp2
  const FORK = writeSession("2026-01-03T00-00-00-000Z_fork.jsonl",
    { type: "session", id: "fork", timestamp: "2026-01-03T00:00:00Z", cwd: "/home/user/proj",
      parentSession: MAIN, forkedAtHash: "cp1" },
    mainEntries.slice(0, 2)); // u1, a1
  saveCheckpoints({
    root: [
      { hash: "cp1", anchorId: "a1", leafId: "a1", dir: "/d", sessionPath: MAIN, timestamp: "2026-01-01T01:00:00Z" },
      { hash: "cp0", anchorId: "u1", leafId: "u1", dir: "/d", sessionPath: MAIN, timestamp: "2026-01-01T00:30:00Z" },
    ],
    fork: [
      // inherited from root at fork time:
      { hash: "cp1", anchorId: "a1", leafId: "a1", dir: "/d", sessionPath: FORK, timestamp: "2026-01-01T01:00:00Z" },
      // its own new one:
      { hash: "cp2", anchorId: "a1", leafId: "a1", dir: "/d", sessionPath: FORK, timestamp: "2026-01-03T01:00:00Z" },
    ],
  });

  const { root } = checkpointTree(FORK); // asking from the FORK resolves the family root
  assert.equal(root.id, "root");
  assert.deepEqual(root.checkpoints.map((c) => c.hash).sort(), ["cp0", "cp1"]);
  assert.equal(root.children.length, 1);
  const forkNode = root.children[0];
  assert.equal(forkNode.id, "fork");
  assert.equal(forkNode.forkedAtHash, "cp1");
  // the inherited cp1 is NOT repeated on the fork node
  assert.deepEqual(forkNode.checkpoints.map((c) => c.hash), ["cp2"]);
  rmSync(FORK);
});

test("checkpointTree: legacy forks infer forkedAtHash from newest inherited record", () => {
  clearCheckpoints();
  const LEGACY = writeSession("2026-01-04T00-00-00-000Z_legacy.jsonl",
    { type: "session", id: "legacy", timestamp: "2026-01-04T00:00:00Z", cwd: "/home/user/proj",
      parentSession: MAIN }, // no forkedAtHash header field
    mainEntries.slice(0, 2));
  const shared = [
    { hash: "old", anchorId: "u1", leafId: "u1", dir: "/d", sessionPath: MAIN, timestamp: "2026-01-01T00:10:00Z" },
    { hash: "new", anchorId: "a1", leafId: "a1", dir: "/d", sessionPath: MAIN, timestamp: "2026-01-01T02:00:00Z" },
  ];
  saveCheckpoints({ root: shared, legacy: shared.map((c) => ({ ...c, sessionPath: LEGACY })) });
  const { root } = checkpointTree(MAIN);
  const legacyNode = root.children.find((c) => c.id === "legacy");
  assert.equal(legacyNode.forkedAtHash, "new", "newest inherited record wins");
  rmSync(LEGACY);
});

// ---------------------------------------------------------------- git flow

function initRepo() {
  const repo = mkdtempSync(join(tmpdir(), "pi-ui-test-repo-"));
  const g = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  writeFileSync(join(repo, "a.txt"), "v1\n");
  g("add", "-A");
  g("commit", "-qm", "initial");
  return { repo, g };
}

test("git() reports code/stdout without rejecting", async () => {
  const { repo } = initRepo();
  const ok = await git(repo, ["rev-parse", "--show-toplevel"]);
  assert.equal(ok.code, 0);
  const bad = await git(repo, ["definitely-not-a-command"]);
  assert.notEqual(bad.code, 0);
  rmSync(repo, { recursive: true, force: true });
});

test("checkpointWorkdir: clean tree marks HEAD, dirty tree commits", async () => {
  const { repo, g } = initRepo();

  const clean = await checkpointWorkdir("pi", repo, null);
  assert.equal(clean.status, 200);
  assert.equal(clean.body.committed, false);
  assert.equal(clean.body.message, "initial"); // HEAD subject carried through
  assert.ok(clean.body.hash);

  writeFileSync(join(repo, "a.txt"), "v2\n");
  writeFileSync(join(repo, "b.txt"), "new\n");
  const dirty = await checkpointWorkdir("pi", repo, "my label"); // no model -> no sub-agent
  assert.equal(dirty.status, 200);
  assert.equal(dirty.body.committed, true);
  assert.equal(dirty.body.files, 2);
  assert.equal(dirty.body.message, "checkpoint: my label");
  assert.equal(g("status", "--porcelain").trim(), "", "workdir is clean after checkpoint");
  assert.match(g("log", "-1", "--format=%s"), /checkpoint: my label/);

  rmSync(repo, { recursive: true, force: true });
});

test("checkpointWorkdir refuses non-repos", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-ui-test-norepo-"));
  const r = await checkpointWorkdir("pi", dir, null);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not a git repository/);
  rmSync(dir, { recursive: true, force: true });
});
