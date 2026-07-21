import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createSessionReferenceCodec } from "../session-references.mjs";

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
  const outside = Buffer.from(JSON.stringify({
    b: "sqlite",
    i: "session",
    p: "/tmp/sessions.sqlite",
  })).toString("base64url");
  const malformed = Buffer.from("not json").toString("base64url");
  for (const key of ["", "sqlite:session", "ps1_***", `ps1_${malformed}`, `ps1_${outside}`, `${codec.serialize(sqlite)}=`]) {
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
