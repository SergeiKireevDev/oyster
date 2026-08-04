import test from "node:test";
import assert from "node:assert/strict";
import { createSessionOwnerResolver } from "../server/persistence/sessionOwners.mjs";

function setup({ runners = [], summary = null, now = () => "2026-07-16T00:00:00.000Z", upsert } = {}) {
  const upserts = [];
  const sessions = {
    upsert(owner) {
      upserts.push(owner);
      return upsert ? upsert(owner) : { id: 1, ...owner };
    },
  };
  const ensure = createSessionOwnerResolver({
    appStore: { repositories: { sessions } },
    sessionReferences: {
      sqlitePath: "/agent/sessions.sqlite",
      validate(reference) { return { ...reference }; },
    },
    sessionCatalog: { backend: "sqlite", findById: () => summary },
    runners: typeof runners === "function" ? runners : () => runners,
    now,
  });
  return { ensure, upserts };
}

test("session ownership preserves the complete backend identity", async () => {
  const reference = { backend: "jsonl", id: "session-1", storagePath: "/agent/sessions/one.jsonl" };
  const { ensure, upserts } = setup();
  assert.equal((await ensure(reference)).id, 1);
  assert.deepEqual(upserts, [{ backend: "jsonl", sessionId: "session-1", storagePath: "/agent/sessions/one.jsonl", createdAt: "2026-07-16T00:00:00.000Z" }]);
});

test("session-id ownership resolves active runners before the configured catalog", async () => {
  const reference = { backend: "jsonl", id: "session-1", storagePath: "/agent/sessions/one.jsonl" };
  const { ensure, upserts } = setup({ runners: [{ sessionId: "session-1", sessionRef: reference }] });
  await ensure("session-1");
  assert.equal(upserts[0].storagePath, reference.storagePath);
});

test("session-id ownership resolves catalog sessions and rejects unknown identities", async () => {
  const known = setup({ summary: { id: "sqlite-1" } });
  await known.ensure("sqlite-1");
  assert.deepEqual(known.upserts[0], { backend: "sqlite", sessionId: "sqlite-1", storagePath: "/agent/sessions.sqlite", createdAt: "2026-07-16T00:00:00.000Z" });
  await assert.rejects(() => setup().ensure("missing"), /unknown session missing/);
});

test("resolver validates construction dependencies", () => {
  assert.throws(() => createSessionOwnerResolver(), /repository upsert must be a function/);
  const base = {
    appStore: { repositories: { sessions: { upsert() {} } } },
    sessionReferences: { validate() {} },
    sessionCatalog: { backend: "sqlite", findById() {} },
  };
  assert.throws(() => createSessionOwnerResolver({ ...base, sessionReferences: {} }), /validator must be a function/);
  assert.throws(() => createSessionOwnerResolver({ ...base, sessionCatalog: { backend: "sqlite" } }), /findById must be a function/);
  assert.throws(() => createSessionOwnerResolver({ ...base, sessionCatalog: { backend: "", findById() {} } }), /backend must be a non-empty string/);
  assert.throws(() => createSessionOwnerResolver({ ...base, runners: null }), /runner provider must be a function/);
  assert.throws(() => createSessionOwnerResolver({ ...base, now: null }), /clock must be a function/);
});

test("resolver rejects malformed ids, runner snapshots, and catalog results", async () => {
  await assert.rejects(() => setup().ensure(" bad "), /session id must be a trimmed string/);
  await assert.rejects(() => setup({ runners: () => null }).ensure("session-1"), /must return an iterable/);
  await assert.rejects(() => setup({ runners: [null] }).ensure("session-1"), /entries must be objects/);
  const mismatchedReference = { backend: "jsonl", id: "other", storagePath: "/agent/sessions/other.jsonl" };
  await assert.rejects(() => setup({ runners: [{ sessionId: "session-1", sessionRef: mismatchedReference }] }).ensure("session-1"), /does not match requested session/);
});

test("resolver requires synchronous validated references", async () => {
  const options = {
    appStore: { repositories: { sessions: { upsert: () => ({ id: 1 }) } } },
    sessionCatalog: { backend: "sqlite", findById: () => null },
  };
  for (const invalid of [null, Promise.resolve({ backend: "sqlite", id: "session-1", storagePath: "/agent/sessions.sqlite" })]) {
    const ensure = createSessionOwnerResolver({
      ...options,
      sessionReferences: { validate: () => invalid },
    });
    await assert.rejects(() => ensure({}), /validator must synchronously return an object/);
  }
});

test("resolver validates persistence boundary results and timestamps", async () => {
  await assert.rejects(() => setup({ now: () => "" }).ensure({ backend: "sqlite", id: "session-1", storagePath: "/agent/sessions.sqlite" }), /timestamp must be a non-empty string/);
  await assert.rejects(() => setup({ upsert: () => null }).ensure({ backend: "sqlite", id: "session-1", storagePath: "/agent/sessions.sqlite" }), /positive integer id/);
  assert.equal((await setup({ upsert: () => Promise.resolve({ id: 1 }) }).ensure({ backend: "sqlite", id: "session-1", storagePath: "/agent/sessions.sqlite" })).id, 1);
});
