import { parseSearchTerms } from "./searchQuery.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

function snippetText(result) {
  const snippet = result?.snippet ?? {};
  return `${snippet.before ?? ""}${snippet.match ?? ""}${snippet.after ?? ""}`;
}

function quotedPhrases(query) {
  const phrases = [];
  const source = String(query ?? "");
  let current = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === "\\" && source[index + 1] === '"') {
      if (quoted) current += '"';
      index++;
    } else if (character === '"') {
      if (quoted && current.trim()) phrases.push(current.trim().toLowerCase());
      current = "";
      quoted = !quoted;
    } else if (quoted) current += character;
  }
  return phrases;
}

function occurrences(text, term) {
  const positions = [];
  for (let index = text.indexOf(term); index >= 0; index = text.indexOf(term, index + term.length)) positions.push(index);
  return positions;
}

function hasTokenBoundaries(text, index, length) {
  const token = /[\p{L}\p{N}_]/u;
  return !token.test(text[index - 1] ?? "") && !token.test(text[index + length] ?? "");
}

function proximityScore(positionSets) {
  if (positionSets.length < 2 || positionSets.some((positions) => !positions.length)) return 0;
  const events = positionSets.flatMap((positions, termIndex) => positions.map((position) => ({ position, termIndex })))
    .sort((left, right) => left.position - right.position);
  const counts = new Array(positionSets.length).fill(0);
  let covered = 0;
  let start = 0;
  let smallestSpan = Infinity;
  for (let end = 0; end < events.length; end++) {
    if (counts[events[end].termIndex]++ === 0) covered++;
    while (covered === positionSets.length) {
      smallestSpan = Math.min(smallestSpan, events[end].position - events[start].position);
      if (--counts[events[start].termIndex] === 0) covered--;
      start++;
    }
  }
  return Math.max(0, 30 - smallestSpan / 8);
}

/** Deterministically score one search result without mutating it or reading ambient state. */
export function scoreSearchResult(result, query, { referenceTime = null } = {}) {
  const text = snippetText(result).toLowerCase();
  const terms = parseSearchTerms(query);
  const positions = terms.map((term) => occurrences(text, term));
  const matchedTerms = positions.filter((matches) => matches.length).length;
  let score = terms.length ? (matchedTerms / terms.length) * 60 : 0;

  if (terms.length && matchedTerms === terms.length) score += 40;
  for (const phrase of quotedPhrases(query)) if (text.includes(phrase)) score += 120;
  if (terms.length > 1 && text.includes(terms.join(" "))) score += 70;
  score += proximityScore(positions);

  for (let index = 0; index < terms.length; index++) {
    score += Math.min(positions[index].length, 3) * 2;
    if (positions[index].some((position) => hasTokenBoundaries(text, position, terms[index].length))) score += 8;
  }

  if (result?.kind === "name") score += 50;
  else if (result?.role === "user") score += 20;
  else if (result?.role === "assistant") score += 10;

  const timestamp = Date.parse(result?.timestamp ?? "");
  if (Number.isFinite(timestamp) && Number.isFinite(referenceTime)) {
    const age = Math.max(0, referenceTime - timestamp);
    score += 12 * Math.exp(-age / (30 * DAY_MS));
  }
  return score;
}

/** Return a relevance-sorted copy, preserving original order for equal scores. */
export function rescoreSearchResults(results, query) {
  const candidates = Array.isArray(results) ? results : [];
  const timestamps = candidates.map((result) => Date.parse(result?.timestamp ?? "")).filter(Number.isFinite);
  const referenceTime = timestamps.length ? Math.max(...timestamps) : null;
  return candidates
    .map((result, index) => ({ result, index, score: scoreSearchResult(result, query, { referenceTime }) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ result }) => result);
}
