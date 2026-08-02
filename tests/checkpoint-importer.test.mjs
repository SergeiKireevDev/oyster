import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { importLegacyCheckpoints } from "../server/persistence/checkpointImporter.mjs";
import { createSessionReferenceCodec } from "../server/session-references.mjs";

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-checkpoint-import-"));
  const agentDir = join(root, ".pi", "agent");
  const store = openAppStore({ databasePath: join(agentDir, "oyster.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return {
    root,
    store,
    codec: createSessionReferenceCodec({ agentDir, jsonlRoot: join(agentDir, "sessions") }),
    sourcePath: join(agentDir, "checkpoints.json"),
  };
}

test("legacy checkpoint import is repeatable and leaves its source untouched", (t) => {
  const { store, codec, sourcePath } = setup(t);
  const sessionPath = join(codec.jsonlRoot, "project", "session-a.jsonl");
  const source = JSON.stringify({
    "session-a": [
      { hash: "one", anchorId: "entry-1", leafId: "entry-1", dir: "/work", sessionPath, timestamp: "time-1" },
      { hash: "two", anchorId: "entry-2", leafId: "entry-2", dir: "/work", sessionPath, timestamp: "time-2" },
    ],
  }, null, 2);
  writeFileSync(sourcePath, source);

  const first = importLegacyCheckpoints({ repository: store.repositories.checkpoints, sessionReferences: codec, sourcePath });
  const second = importLegacyCheckpoints({ repository: store.repositories.checkpoints, sessionReferences: codec, sourcePath });

  assert.deepEqual({ ...first, sourcePath: undefined }, {
    sourcePath: undefined, sourceCount: 2, importedCount: 2, existingCount: 0, status: "imported",
  });
  assert.equal(second.importedCount, 0);
  assert.equal(second.existingCount, 2);
  assert.equal(store.repositories.checkpoints.listBySessionId("session-a", "jsonl").length, 2);
  assert.equal(readFileSync(sourcePath, "utf8"), source);
});

test("legacy checkpoint import validates the complete source before writing", (t) => {
  const { store, codec, sourcePath } = setup(t);
  const sessionPath = join(codec.jsonlRoot, "project", "session-a.jsonl");
  writeFileSync(sourcePath, JSON.stringify({
    "session-a": [
      { hash: "valid", anchorId: "entry-1", sessionPath },
      { hash: "missing-anchor", sessionPath },
    ],
  }));

  assert.throws(() => importLegacyCheckpoints({ repository: store.repositories.checkpoints, sessionReferences: codec, sourcePath }), /malformed legacy checkpoint/);
  assert.deepEqual(store.repositories.checkpoints.listBySessionId("session-a", "jsonl"), []);
});

test("legacy checkpoint import reports a missing source as an idempotent no-op", (t) => {
  const { store, codec, sourcePath } = setup(t);
  assert.deepEqual(importLegacyCheckpoints({ repository: store.repositories.checkpoints, sessionReferences: codec, sourcePath }), {
    sourcePath, sourceCount: 0, importedCount: 0, existingCount: 0, status: "missing",
  });
});

test("legacy checkpoint import rejects duplicate and invalid checkpoint identities before repository access", (t) => {
  const { codec, sourcePath } = setup(t);
  const sessionPath = join(codec.jsonlRoot, "project", "session-a.jsonl");
  let listCalls = 0;
  const repository = {
    listForSession() { listCalls++; return []; },
    record() { assert.fail("record must not be called"); },
  };

  for (const checkpoints of [
    [{ hash: 42, anchorId: "entry-1", sessionPath }],
    [
      { hash: "same", anchorId: "entry-1", sessionPath },
      { hash: "same", anchorId: "entry-1", sessionPath },
    ],
  ]) {
    writeFileSync(sourcePath, JSON.stringify({ "session-a": checkpoints }));
    assert.throws(
      () => importLegacyCheckpoints({ repository, sessionReferences: codec, sourcePath }),
      /malformed|duplicate legacy checkpoint/,
    );
  }
  assert.equal(listCalls, 0);
});

test("legacy checkpoint import inspects each session once and compares payloads independent of key order", (t) => {
  const { codec, sourcePath } = setup(t);
  const sessionPath = join(codec.jsonlRoot, "project", "session-a.jsonl");
  const reference = codec.validate({ backend: "jsonl", id: "session-a", storagePath: sessionPath });
  const existing = {
    sessionRef: reference,
    sessionPath,
    anchorId: "entry-1",
    hash: "same",
  };
  writeFileSync(sourcePath, JSON.stringify({
    "session-a": [
      { hash: "same", anchorId: "entry-1", sessionPath },
      { hash: "new", anchorId: "entry-2", sessionPath },
    ],
  }));
  let listCalls = 0;
  let recordCalls = 0;
  const conflicts = [];
  const candidates = [];
  const report = importLegacyCheckpoints({
    repository: {
      listForSession() { listCalls++; return [existing]; },
      record() { recordCalls++; },
    },
    sessionReferences: codec,
    sourcePath,
    apply: false,
    onConflict: (conflict) => conflicts.push(conflict),
    onCandidate: (candidate) => candidates.push(candidate),
  });

  assert.equal(listCalls, 1);
  assert.equal(recordCalls, 0);
  assert.deepEqual(conflicts, []);
  assert.deepEqual({ ...report }, {
    sourcePath, sourceCount: 2, importedCount: 1, existingCount: 1, status: "dry-run",
  });
  assert.equal(Object.isFrozen(candidates[0]), true);
  assert.equal(Object.isFrozen(candidates[0].checkpoint), true);
});

test("legacy checkpoint import validates dependencies, options, and session path consistency", (t) => {
  const { codec, sourcePath } = setup(t);
  const repository = { listForSession: () => [], record: () => {} };
  assert.throws(() => importLegacyCheckpoints({ sessionReferences: codec, sourcePath }), /checkpoint repository/);
  assert.throws(() => importLegacyCheckpoints({ repository, sourcePath }), /session reference codec/);
  assert.throws(() => importLegacyCheckpoints({ repository, sessionReferences: codec, sourcePath, apply: "yes" }), /apply must be a boolean/);

  const sessionPath = join(codec.jsonlRoot, "project", "session-a.jsonl");
  writeFileSync(sourcePath, JSON.stringify({
    "session-a": [{
      hash: "hash",
      anchorId: "anchor",
      sessionPath,
      sessionRef: { backend: "jsonl", id: "session-a", storagePath: join(codec.jsonlRoot, "other.jsonl") },
    }],
  }));
  assert.throws(
    () => importLegacyCheckpoints({ repository, sessionReferences: codec, sourcePath }),
    /session paths differ/,
  );
});
