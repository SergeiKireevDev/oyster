import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { importLegacyCheckpoints } from "../server/persistence/checkpointImporter.mjs";
import { createSessionReferenceCodec } from "../server/session-references.mjs";

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-checkpoint-import-"));
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
