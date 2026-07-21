import test from "node:test";
import assert from "node:assert/strict";
import { createSessionOwnerResolver } from "../persistence/sessionOwners.mjs";

function setup({ runners = [], summary = null } = {}) {
  const upserts = [];
  const ensure = createSessionOwnerResolver({
    appStore: { repositories: { sessions: { upsert(owner) { upserts.push(owner); return owner; } } } },
    sessionReferences: {
      sqlitePath: "/agent/sessions.sqlite",
      validate(reference) { return { ...reference }; },
    },
    sessionCatalog: { backend: "sqlite", findById: () => summary },
    runners: () => runners,
    now: () => "2026-07-16T00:00:00.000Z",
  });
  return { ensure, upserts };
}

test("session ownership preserves the complete backend identity", () => {
  const reference = { backend: "jsonl", id: "session-1", storagePath: "/agent/sessions/one.jsonl" };
  const { ensure, upserts } = setup();
  ensure(reference);
  assert.deepEqual(upserts, [{ backend: "jsonl", sessionId: "session-1", storagePath: "/agent/sessions/one.jsonl", createdAt: "2026-07-16T00:00:00.000Z" }]);
});

test("session-id ownership resolves active runners before the configured catalog", () => {
  const reference = { backend: "jsonl", id: "session-1", storagePath: "/agent/sessions/one.jsonl" };
  const { ensure, upserts } = setup({ runners: [{ sessionId: "session-1", sessionRef: reference }] });
  ensure("session-1");
  assert.equal(upserts[0].storagePath, reference.storagePath);
});

test("session-id ownership resolves catalog sessions and rejects unknown identities", () => {
  const known = setup({ summary: { id: "sqlite-1" } });
  known.ensure("sqlite-1");
  assert.deepEqual(known.upserts[0], { backend: "sqlite", sessionId: "sqlite-1", storagePath: "/agent/sessions.sqlite", createdAt: "2026-07-16T00:00:00.000Z" });
  assert.throws(() => setup().ensure("missing"), /unknown session missing/);
});
