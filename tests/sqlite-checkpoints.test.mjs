import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionReferenceCodec } from "../session-references.mjs";

const home = mkdtempSync(join(tmpdir(), "pi-sqlite-checkpoints-"));
process.env.HOME = home;
const { checkpointTree, recordCheckpoint } = await import("../checkpoints.mjs");
let repositoryRecords = {};
const repository = {
  record(reference, checkpoint) { (repositoryRecords[reference.id] ??= []).push(checkpoint); return checkpoint; },
  listForSession(reference) { return repositoryRecords[reference.id] ?? []; },
};
after(() => rmSync(home, { recursive: true, force: true }));

const storagePath = join(home, ".pi", "agent", "sessions.sqlite");
mkdirSync(join(home, ".pi", "agent"), { recursive: true });
const codec = createSessionReferenceCodec({ agentDir: join(home, ".pi", "agent"), sqlitePath: storagePath });
const rootRef = { backend: "sqlite", id: "root", storagePath };
const forkRef = { backend: "sqlite", id: "fork", storagePath };
const summaries = [
  { id: "root", cwd: "/work", createdAt: "2026-01-01", parentSessionId: null, name: "Root" },
  { id: "fork", cwd: "/work", createdAt: "2026-01-02", parentSessionId: "root", name: "Fork" },
];
const catalog = {
  backend: "sqlite",
  storagePath,
  entries: (id) => ({
    sessionId: id,
    leafId: id === "root" ? "a1" : "a2",
    entries: id === "root" ? [{ id: "u1" }, { id: "a1" }] : [{ id: "u1" }, { id: "a1" }, { id: "a2" }],
  }),
  readHeader: (id) => summaries.find((session) => session.id === id) ?? null,
  list: ({ cwd }) => summaries.filter((session) => session.cwd === cwd),
};

test("SQLite checkpoint recording stores database-plus-ID identity and tip anchors", () => {
  repositoryRecords = {};
  const checkpoint = recordCheckpoint(rootRef, "/work", { hash: "abc", message: "checkpoint: sqlite" }, { catalog, repository });
  assert.equal(checkpoint.anchorId, "a1");
  assert.equal(checkpoint.leafId, "a1");
  assert.deepEqual(checkpoint.sessionRef, rootRef);
  assert.equal("sessionPath" in checkpoint, false);
  assert.deepEqual(repositoryRecords.root[0].sessionRef, rootRef);
});

test("SQLite checkpoint trees group families by parent ID and expose opaque keys", () => {
  const inherited = { hash: "base", anchorId: "a1", timestamp: "2026-01-01" };
  repositoryRecords = {
    root: [inherited],
    fork: [inherited, { hash: "fork-only", anchorId: "a2", timestamp: "2026-01-02" }],
  };
  const { root } = checkpointTree(forkRef, { catalog, sessionReferences: codec, repository });
  assert.equal(root.id, "root");
  assert.equal(root.sessionKey, codec.serialize(rootRef));
  assert.equal(root.path, null);
  assert.equal(root.children[0].id, "fork");
  assert.equal(root.children[0].sessionKey, codec.serialize(forkRef));
  assert.deepEqual(root.children[0].checkpoints.map((checkpoint) => checkpoint.hash), ["fork-only"]);
});
