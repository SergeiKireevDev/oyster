import test from "node:test";
import assert from "node:assert/strict";

/** Shared behavioral suite for JSONL and SQLite saved-session catalogs. */
export function runSessionCatalogContract(name, createFixture) {
  test(`${name} catalog lists and summarizes sessions`, async () => {
    const { catalog, cwd, rootId, rootIdentity } = await createFixture();
    const listed = await catalog.list({ cwd });
    assert.equal(listed.length, 2);
    assert.equal(listed.find((session) => session.id === rootId)?.preview, "root prompt");
    assert.equal((await catalog.findById(rootId)).id, rootId);
    assert.equal((await catalog.summarize(rootIdentity)).messageCount, 2);
  });

  test(`${name} catalog exposes headers, active entries, and messages`, async () => {
    const { catalog, rootId, rootIdentity } = await createFixture();
    const header = await catalog.readHeader(rootIdentity);
    assert.equal(header.id, rootId);
    const active = await catalog.entries(rootIdentity);
    assert.equal(active.sessionId, rootId);
    assert.deepEqual(active.entries.map((entry) => entry.role), ["user", "assistant"]);
    const transcript = await catalog.messages(rootIdentity);
    assert.deepEqual(transcript.messages.map((message) => message.role), ["user", "assistant"]);
  });

  test(`${name} catalog supports folder discovery and text search`, async () => {
    const { catalog, cwd, rootId, rootIdentity } = await createFixture();
    const folders = await catalog.folders();
    assert.ok(folders.some((folder) => folder.dir === catalog.locationForCwd(cwd) && folder.count === 2));
    const search = await catalog.search({ q: "durable phrase", scope: "session", path: rootIdentity });
    assert.equal(search.results.length, 1);
    assert.equal(search.results[0].sessionId, rootId);
  });
}
