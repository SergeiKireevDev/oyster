import test from "node:test";
import assert from "node:assert/strict";
import { rescoreSearchResults, scoreSearchResult } from "../server/sessions/searchRescore.mjs";

function hit(text, overrides = {}) {
  return {
    role: "assistant",
    kind: "text",
    timestamp: "2026-01-01T00:00:00Z",
    snippet: { before: "", match: text, after: "" },
    ...overrides,
  };
}

test("search rescoring favors phrase, coverage, boundaries, and user fields", () => {
  const phrase = hit("database migration", { role: "user" });
  const separated = hit("database notes followed much later by migration");
  const partial = hit("database only");
  const incidental = hit("predatabase migrationist");
  const results = rescoreSearchResults([partial, incidental, separated, phrase], "database migration");
  assert.deepEqual(results, [phrase, incidental, separated, partial]);

  const bounded = hit("database x migration");
  const embedded = hit("predatabase x migrationist");
  assert.deepEqual(rescoreSearchResults([embedded, bounded], "database migration"), [bounded, embedded]);
});

test("search rescoring gives names a field boost and quoted phrases an exact boost", () => {
  const title = hit("release database migration", { kind: "name", role: "meta" });
  const message = hit("release database migration", { role: "user" });
  assert.ok(scoreSearchResult(title, '"database migration"') > scoreSearchResult(message, '"database migration"'));
});

test("search rescoring counts each quoted phrase once and ignores query NUL bytes", () => {
  const result = hit("database migration");
  const quotedScore = scoreSearchResult(result, '"database migration"');
  assert.equal(scoreSearchResult(result, '"database migration" "database migration"'), quotedScore);
  assert.equal(scoreSearchResult(result, '"data\0base migration"'), quotedScore);
  assert.equal(scoreSearchResult(result, '"database migration'), quotedScore);
});

test("search rescoring recognizes Unicode token boundaries", () => {
  const bounded = hit("database");
  const astralLetterPrefix = hit("𐐀database");
  const combiningMarkSuffix = hit("database\u0301");

  assert.ok(scoreSearchResult(bounded, "database") > scoreSearchResult(astralLetterPrefix, "database"));
  assert.ok(scoreSearchResult(bounded, "database") > scoreSearchResult(combiningMarkSuffix, "database"));
});

test("search rescoring uses recency only as a modest deterministic tie-breaker", () => {
  const old = hit("database", { timestamp: "2025-01-01T00:00:00Z" });
  const recent = hit("database", { timestamp: "2026-01-01T00:00:00Z" });
  assert.deepEqual(rescoreSearchResults([old, recent], "database"), [recent, old]);
});

test("search rescoring is stable and does not mutate the candidate list", () => {
  const first = hit("database");
  const second = hit("database");
  const candidates = [first, second];
  const rescored = rescoreSearchResults(candidates, "database");
  assert.deepEqual(rescored, candidates);
  assert.notEqual(rescored, candidates);
  assert.deepEqual(candidates, [first, second]);
});
