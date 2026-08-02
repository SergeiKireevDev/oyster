import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createSessionReferenceCodec, createSessionRequestResolver } from "../server/session-references.mjs";

const agentDir = "/home/test/.pi/agent";
const jsonlRoot = join(agentDir, "sessions");
const sqlitePath = join(agentDir, "sessions.sqlite");
const codec = createSessionReferenceCodec({ agentDir, jsonlRoot, sqlitePath });

const jsonl = {
  backend: "jsonl",
  id: "session-jsonl",
  storagePath: join(jsonlRoot, "--workspace--", "turns.jsonl"),
};
const sqlite = { backend: "sqlite", id: "session-sqlite", storagePath: sqlitePath };

test("session references round-trip through canonical URL-safe opaque keys", () => {
  for (const reference of [jsonl, sqlite]) {
    const key = codec.serialize(reference);
    assert.match(key, /^ps1_[A-Za-z0-9_-]+$/);
    assert.deepEqual(codec.parse(key), reference);
    assert.equal(codec.serialize(codec.parse(key)), key);
  }
});

test("session equality includes backend, ID, and storage path", () => {
  assert.equal(codec.equals(sqlite, { ...sqlite }), true);
  assert.equal(codec.equals(sqlite, { ...sqlite, id: "other" }), false);
  assert.equal(codec.equals(jsonl, { ...jsonl, id: "other" }), false);
  assert.equal(codec.equals(jsonl, sqlite), false);
});

test("multiple SQLite sessions sharing one database remain distinct", () => {
  const first = codec.serialize({ ...sqlite, id: "first" });
  const second = codec.serialize({ ...sqlite, id: "second" });
  assert.notEqual(first, second);
  assert.equal(codec.equals(codec.parse(first), codec.parse(second)), false);
});

test("session references reject malformed identities and traversal", () => {
  for (const reference of [
    null,
    { ...sqlite, backend: "memory" },
    { ...sqlite, id: "" },
    { ...sqlite, id: " leading-space" },
    { ...sqlite, id: "bad\nvalue" },
    { ...sqlite, storagePath: join(agentDir, "other.sqlite") },
    { ...jsonl, storagePath: join(jsonlRoot, "..", "escaped.jsonl") },
    { ...jsonl, storagePath: join(jsonlRoot, "not-json.txt") },
  ]) {
    assert.throws(() => codec.validate(reference));
  }
});

test("session keys reject corrupt, non-canonical, and out-of-scope payloads", () => {
  const encode = (value) => `ps1_${Buffer.from(value).toString("base64url")}`;
  const outside = JSON.stringify({ b: "sqlite", i: "session", p: "/tmp/sessions.sqlite" });
  const reordered = JSON.stringify({ i: sqlite.id, b: sqlite.backend, p: sqlite.storagePath });
  const extraProperty = JSON.stringify({ b: sqlite.backend, i: sqlite.id, p: sqlite.storagePath, extra: true });
  for (const key of [
    "",
    "sqlite:session",
    "ps1_***",
    encode("not json"),
    encode(outside),
    encode(reordered),
    encode(extraProperty),
    `${codec.serialize(sqlite)}=`,
  ]) {
    assert.throws(() => codec.parse(key));
  }
});

test("custom session locations are resolved once by the codec", () => {
  const custom = createSessionReferenceCodec({
    agentDir,
    jsonlRoot: "/srv/pi/sessions",
    sqlitePath: "/srv/pi/storage/sessions.sqlite",
  });
  assert.deepEqual(custom.validate({
    backend: "sqlite",
    id: "custom",
    storagePath: "/srv/pi/storage/../storage/sessions.sqlite",
  }), {
    backend: "sqlite",
    id: "custom",
    storagePath: "/srv/pi/storage/sessions.sqlite",
  });
  assert.throws(() => custom.validate(sqlite));
});

test("codec construction rejects invalid path configuration", () => {
  for (const options of [
    undefined,
    {},
    { agentDir: 42 },
    { agentDir, jsonlRoot: "" },
    { agentDir, sqlitePath: null },
  ]) {
    assert.throws(() => createSessionReferenceCodec(options), TypeError);
  }
});

test("request resolver supports opaque keys and legacy JSONL paths", () => {
  const headers = new Map([[jsonl.storagePath, { id: jsonl.id }]]);
  const resolver = createSessionRequestResolver({
    codec,
    sessionFileParam: (path) => path === jsonl.storagePath ? path : null,
    sessionFileFromSearch: (url) => url.searchParams.get("path") === jsonl.storagePath ? jsonl.storagePath : null,
    readSessionHeaderInfo: (path) => headers.get(path),
  });
  const keyUrl = new URL(`http://localhost/sessions?key=${codec.serialize(jsonl)}`);
  const pathUrl = new URL(`http://localhost/sessions?path=${encodeURIComponent(jsonl.storagePath)}`);

  assert.equal(resolver.targetFromSearch(keyUrl), jsonl.storagePath);
  assert.deepEqual(resolver.referenceFromSearch(keyUrl), jsonl);
  assert.deepEqual(resolver.referenceFromSearch(pathUrl), jsonl);
  assert.deepEqual(resolver.referenceParam({ sessionPath: jsonl.storagePath }), jsonl);
  assert.deepEqual(resolver.referenceParam({ sessionKey: codec.serialize(sqlite) }), sqlite);
});

test("request resolver rejects malformed explicit keys without falling back to legacy paths", () => {
  let legacyLookups = 0;
  const resolver = createSessionRequestResolver({
    codec,
    sessionFileParam: () => jsonl.storagePath,
    sessionFileFromSearch: () => { legacyLookups += 1; return jsonl.storagePath; },
    readSessionHeaderInfo: () => ({ id: jsonl.id }),
  });
  const url = new URL(`http://localhost/sessions?key=&path=${encodeURIComponent(jsonl.storagePath)}`);

  assert.equal(resolver.targetFromSearch(url), null);
  assert.equal(resolver.referenceFromSearch(url), null);
  assert.equal(resolver.referenceParam({ sessionKey: "", sessionPath: jsonl.storagePath }), null);
  assert.equal(legacyLookups, 0);
});

test("request resolver validates dependencies and contains adapter failures", () => {
  assert.throws(() => createSessionRequestResolver(), /codec/);
  assert.throws(() => createSessionRequestResolver({ codec }), /sessionFileParam/);

  const resolver = createSessionRequestResolver({
    codec,
    sessionFileParam: () => { throw new Error("lookup failed"); },
    sessionFileFromSearch: () => { throw new Error("lookup failed"); },
    readSessionHeaderInfo: () => { throw new Error("read failed"); },
  });
  assert.equal(resolver.targetFromSearch(new URL("http://localhost/?path=x")), null);
  assert.equal(resolver.referenceFromSearch(new URL("http://localhost/?path=x")), null);
  assert.equal(resolver.referenceParam({ sessionPath: "x" }), null);
});
