import test from "node:test";
import assert from "node:assert/strict";
import {
  ftsSearchExpression,
  matchingSearchTerms,
  matchSearchText,
  parseSearchQuery,
  parseSearchTerms,
} from "../server/sessions/searchQuery.mjs";

test("search query parsing handles terms, phrases, OR, escaping, and duplicates", () => {
  assert.deepEqual(parseSearchQuery(' Alpha alpha "two words" OR "say \\"hello\\"" '), {
    terms: ["alpha", "two words", 'say "hello"'],
    operator: "OR",
  });
  assert.deepEqual(parseSearchTerms("one two three"), ["one", "two", "three"]);
  assert.deepEqual(parseSearchQuery('or "or"'), { terms: ["or"], operator: "OR" });
});

test("search query parsing ignores short bare terms and safely removes NUL bytes", () => {
  assert.deepEqual(parseSearchTerms('ab "ab" abc'), ["ab", "abc"]);
  assert.deepEqual(parseSearchTerms("dur\0able"), ["durable"]);
  assert.deepEqual(parseSearchTerms("İx"), []);
});

test("FTS expressions quote literals and only accept the explicit OR operator", () => {
  assert.equal(ftsSearchExpression(['say "hello"', "foo-bar"], "OR"), '"say ""hello""" OR "foo-bar"');
  assert.equal(ftsSearchExpression(["alpha", "beta"], "or"), '"alpha" AND "beta"');
  assert.equal(ftsSearchExpression(["dur\0able"]), '"durable"');
});

test("literal matching is case-insensitive and preserves source offsets after case expansion", () => {
  assert.deepEqual(matchingSearchTerms("prefix İx suffix", ["PREFIX", "i̇x"]), [
    { termIndex: 0, index: 0, length: 6 },
    { termIndex: 1, index: 7, length: 2 },
  ]);
  assert.deepEqual(matchSearchText("prefix İx suffix", ["prefix", "i̇x"]), {
    termIndex: 0,
    index: 0,
    length: 6,
  });
});

test("literal matching enforces AND by default and supports OR", () => {
  assert.equal(matchSearchText("alpha only", ["alpha", "beta"]), null);
  assert.deepEqual(matchSearchText("alpha only", ["alpha", "beta"], "OR"), {
    termIndex: 0,
    index: 0,
    length: 5,
  });
  assert.equal(matchSearchText("anything", []), null);
});
