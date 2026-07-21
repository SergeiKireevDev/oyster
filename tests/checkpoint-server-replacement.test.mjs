import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { createCheckpointRollbackJournal } from "../server/persistence/checkpointRollbackJournal.mjs";
import { checkpointTree } from "../server/checkpoints.mjs";

test("checkpoint trees and in-progress rollback records survive stable server replacement", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-checkpoint-replacement-"));
  const databasePath = join(root, "app.sqlite");
  let store = openAppStore({ databasePath });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });

  const rootRef = { backend: "jsonl", id: "root", storagePath: "/sessions/root.jsonl" };
  const forkRef = { backend: "jsonl", id: "fork", storagePath: "/sessions/fork.jsonl" };
  const rootCheckpoint = { hash: "root-hash", anchorId: "root-anchor", leafId: "root-leaf", dir: "/work", sessionRef: rootRef, timestamp: "2026-07-16T01:00:00.000Z" };
  store.repositories.checkpoints.record(rootRef, rootCheckpoint);
  store.repositories.checkpoints.record(forkRef, { ...rootCheckpoint, sessionRef: forkRef });
  store.repositories.checkpoints.record(forkRef, { hash: "fork-hash", anchorId: "fork-anchor", leafId: "fork-leaf", dir: "/work", sessionRef: forkRef, timestamp: "2026-07-16T02:00:00.000Z" });

  const owner = store.repositories.sessions.find({ backend: rootRef.backend, sessionId: rootRef.id, storagePath: rootRef.storagePath });
  const rollback = createCheckpointRollbackJournal({
    appStore: store,
    ensureSessionOwner: () => owner,
    operationId: () => "rollback-across-replacement",
    now: () => "2026-07-16T03:00:00.000Z",
  }).start({ reference: rootRef, hash: rootCheckpoint.hash, dir: "/work" });
  rollback.advance("session_forked", { forkReference: forkRef });

  const headers = new Map([
    [rootRef.storagePath, { id: "root", cwd: "/work", parentSession: null }],
    [forkRef.storagePath, { id: "fork", cwd: "/work", parentSession: rootRef.storagePath }],
  ]);
  const catalog = {
    backend: "jsonl",
    readHeader: (path) => headers.get(path) ?? null,
    list: () => [
      { id: "root", path: rootRef.storagePath },
      { id: "fork", path: forkRef.storagePath },
    ],
  };
  const renderTree = (repository) => checkpointTree(forkRef, { catalog, repository });
  const beforeReplacement = renderTree(store.repositories.checkpoints);

  store.close();
  store = openAppStore({ databasePath });
  assert.equal(store.reconcileInterruptedOperations("2026-07-16T04:00:00.000Z"), 1);

  const afterReplacement = renderTree(store.repositories.checkpoints);
  assert.deepEqual(afterReplacement, beforeReplacement);
  assert.deepEqual(afterReplacement.root.checkpoints.map(({ hash }) => hash), ["root-hash"]);
  assert.deepEqual(afterReplacement.root.children[0].checkpoints.map(({ hash }) => hash), ["fork-hash"]);

  const recoveredRollback = store.repositories.operations.find("rollback-across-replacement");
  assert.equal(recoveredRollback.kind, "checkpoint_rollback");
  assert.equal(recoveredRollback.status, "interrupted");
  assert.equal(recoveredRollback.stage, "session_forked");
  assert.deepEqual(JSON.parse(recoveredRollback.payload).forkReference, forkRef);
  assert.equal(store.hydrate().incompleteOperations.some(({ id }) => id === recoveredRollback.id), true);
});
