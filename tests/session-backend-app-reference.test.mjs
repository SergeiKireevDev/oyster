import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { createSessionReferenceCodec } from "../server/session-references.mjs";

test("SQLite and JSONL session identities safely own resources in the separate app database", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-dual-backend-app-refs-"));
  const appDatabasePath = join(root, "oyster.sqlite");
  const codingDatabasePath = join(root, "coding-agent-sessions.sqlite");
  const jsonlRoot = join(root, "sessions");
  const jsonlPath = join(jsonlRoot, "project", "session.jsonl");
  mkdirSync(dirname(jsonlPath), { recursive: true });
  const jsonlSource = '{"type":"session","id":"jsonl-session","cwd":"/work"}\n';
  writeFileSync(jsonlPath, jsonlSource);
  const codingDatabase = new DatabaseSync(codingDatabasePath);
  codingDatabase.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY, payload TEXT); INSERT INTO sessions VALUES ('sqlite-session', 'agent-owned');");
  codingDatabase.close();
  const codingDatabaseBefore = readFileSync(codingDatabasePath);
  let store = openAppStore({ databasePath: appDatabasePath });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const codec = createSessionReferenceCodec({ agentDir: root, jsonlRoot, sqlitePath: codingDatabasePath });
  const references = {
    jsonl: codec.validate({ backend: "jsonl", id: "jsonl-session", storagePath: jsonlPath }),
    sqlite: codec.validate({ backend: "sqlite", id: "sqlite-session", storagePath: codingDatabasePath }),
  };

  for (const [backend, reference] of Object.entries(references)) {
    const owner = store.repositories.sessions.upsert({
      backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath, createdAt: `${backend}-owner`,
    });
    store.repositories.checkpoints.record(reference, {
      hash: `${backend}-hash`, anchorId: `${backend}-anchor`, sessionRef: reference, timestamp: `${backend}-checkpoint`,
    });
    store.repositories.routines.upsert({
      id: `${backend}-routine`, ownerId: owner.id, name: `${backend}.sh`, script: `echo ${backend}`, now: `${backend}-routine`,
    });
    store.repositories.hublots.create({
      id: `${backend}-hublot`, ownerId: owner.id, port: backend === "jsonl" ? 4340 : 4341, workdir: "/work",
      serviceKind: "self_served", status: "closed", desiredState: "closed", createdAt: `${backend}-hublot`,
    });
    store.repositories.runners.create({
      id: `${backend}-runner0`, ownerId: owner.id, dir: "/work", sessionBackend: reference.backend,
      sessionId: reference.id, sessionStoragePath: reference.storagePath, desiredState: "stopped", lastStatus: "stopped", createdAt: `${backend}-runner`,
    });
  }
  store.close();
  store = openAppStore({ databasePath: appDatabasePath });

  for (const [backend, reference] of Object.entries(references)) {
    const owner = store.repositories.sessions.find({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath });
    assert.ok(owner);
    assert.equal(store.repositories.checkpoints.listForSession(reference)[0].sessionRef.backend, backend);
    assert.equal(store.repositories.routines.findByName(`${backend}.sh`).owner_id, owner.id);
    assert.equal(store.repositories.hublots.find(`${backend}-hublot`).owner_id, owner.id);
    assert.equal(store.repositories.runners.find(`${backend}-runner0`).owner_id, owner.id);
  }
  assert.notEqual(references.sqlite.storagePath, appDatabasePath);
  assert.equal(readFileSync(jsonlPath, "utf8"), jsonlSource, "app persistence never rewrites JSONL sessions");
  assert.deepEqual(readFileSync(codingDatabasePath), codingDatabaseBefore, "app persistence never mutates the coding-agent SQLite file");
  const verifyCodingDatabase = new DatabaseSync(codingDatabasePath, { readOnly: true });
  assert.deepEqual(verifyCodingDatabase.prepare("SELECT id, payload FROM sessions").all().map((row) => ({ ...row })), [{ id: "sqlite-session", payload: "agent-owned" }]);
  verifyCodingDatabase.close();
});
