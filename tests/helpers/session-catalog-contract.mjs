import test from "node:test";
import assert from "node:assert/strict";

/** Shared behavioral suite for JSONL and SQLite saved-session catalogs. */
export function runSessionCatalogContract(name, createFixture) {
  test(`${name} catalog lists and summarizes sessions`, async () => {
    const { catalog, cwd, rootId, rootPath } = await createFixture();
    const listed = await catalog.list({ cwd });
    assert.equal(listed.length, 2);
    assert.equal(listed.find((session) => session.id === rootId)?.preview, "root prompt");
    assert.equal((await catalog.findById(rootId)).path, rootPath);
    assert.equal((await catalog.summarize(rootPath)).messageCount, 2);
  });

  test(`${name} catalog exposes headers, active entries, and messages`, async () => {
    const { catalog, rootId, rootPath } = await createFixture();
    const header = await catalog.readHeader(rootPath);
    assert.equal(header.id, rootId);
    const active = await catalog.entries(rootPath);
    assert.equal(active.sessionId, rootId);
    assert.deepEqual(active.entries.map((entry) => entry.role), ["user", "assistant"]);
    const transcript = await catalog.messages(rootPath);
    assert.deepEqual(transcript.messages.map((message) => message.role), ["user", "assistant"]);
  });

  test(`${name} catalog supports folder discovery and text search`, async () => {
    const { catalog, cwd, rootPath } = await createFixture();
    const folders = await catalog.folders();
    assert.ok(folders.some((folder) => folder.dir === catalog.locationForCwd(cwd) && folder.count === 2));
    const search = await catalog.search({ q: "durable phrase", scope: "session", path: rootPath });
    assert.equal(search.results.length, 1);
    assert.equal(search.results[0].sessionId, "catalog-root");
  });
}
