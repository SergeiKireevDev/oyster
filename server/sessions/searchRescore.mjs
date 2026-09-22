import { parseSearchTerms } from "./searchQuery.mjs";
const ASSISTANT_ROLE_SCORE = 10;
const MILLISECONDS_PER_SECOND = 1000;
const RECENCY_SCORE_WEIGHT = 12;
const PHRASE_MATCH_SCORE = 120;
const USER_ROLE_SCORE = 20;
const HOURS_PER_DAY = 24;
const MAX_TOKEN_OCCURRENCES_FOR_SCORE = 3;
const PROXIMITY_BASE_SCORE = 30;
const ALL_TERMS_MATCH_SCORE = 40;
const NAME_RESULT_SCORE = 50;
const SECONDS_PER_MINUTE = 60;
const ORDERED_QUERY_SCORE = 70;
const PROXIMITY_SPAN_DIVISOR = 8;
const HIGH_SURROGATE_MIN = 0xD800;
const HIGH_SURROGATE_MAX = 0xDBFF;
const LOW_SURROGATE_MIN = 0xDC00;
const LOW_SURROGATE_MAX = 0xDFFF;


const DAY_MS = HOURS_PER_DAY * SECONDS_PER_MINUTE * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const TOKEN_CHARACTER = /[\p{L}\p{M}\p{N}_]/u;

function snippetText(result) {
  const snippet = result?.snippet ?? {};
  return `${snippet.before ?? ""}${snippet.match ?? ""}${snippet.after ?? ""}`;
}

function quotedPhrases(query) {
  const phrases = [];
  const seen = new Set();
  const source = String(query ?? "").replaceAll("\0", "");
  let current = "";
  let quoted = false;
  function pushPhrase() {
    const phrase = current.trim().toLowerCase();
    if (phrase && !seen.has(phrase)) {
      seen.add(phrase);
      phrases.push(phrase);
    }
    current = "";
  }

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === "\\" && source[index + 1] === '"') {
      if (quoted) current += '"';
      index++;
    } else if (character === '"') {
      if (quoted) pushPhrase();
      else current = "";
      quoted = !quoted;
    } else if (quoted) current += character;
  }
  if (quoted) pushPhrase();
  return phrases;
}

function occurrences(text, term) {
  const positions = [];
  for (let index = text.indexOf(term); index >= 0; index = text.indexOf(term, index + term.length)) positions.push(index);
  return positions;
}

function codePointBefore(text, index) {
  if (index <= 0) return "";
  const trailingUnit = text.charCodeAt(index - 1);
  if (index > 1 && trailingUnit >= LOW_SURROGATE_MIN && trailingUnit <= LOW_SURROGATE_MAX) {
    const leadingUnit = text.charCodeAt(index - 2);
    if (leadingUnit >= HIGH_SURROGATE_MIN && leadingUnit <= HIGH_SURROGATE_MAX) return text.slice(index - 2, index);
  }
  return text[index - 1];
}

function codePointAt(text, index) {
  const value = text.codePointAt(index);
  return value === undefined ? "" : String.fromCodePoint(value);
}

function hasTokenBoundaries(text, index, length) {
  return !TOKEN_CHARACTER.test(codePointBefore(text, index))
    && !TOKEN_CHARACTER.test(codePointAt(text, index + length));
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
  return Math.max(0, PROXIMITY_BASE_SCORE - smallestSpan / PROXIMITY_SPAN_DIVISOR);
}

function termMatchBoost(text, terms, positions) {
  let boost = 0;
  for (let index = 0; index < terms.length; index++) {
    boost += Math.min(positions[index].length, MAX_TOKEN_OCCURRENCES_FOR_SCORE) * 2;
    if (positions[index].some((position) => hasTokenBoundaries(text, position, terms[index].length))) boost += PROXIMITY_SPAN_DIVISOR;
  }
  return boost;
}

function roleBoost(result) {
  if (result?.kind === "name") return NAME_RESULT_SCORE;
  if (result?.role === "user") return USER_ROLE_SCORE;
  return result?.role === "assistant" ? ASSISTANT_ROLE_SCORE : 0;
}

/** Deterministically score one search result without mutating it or reading ambient state. */
export function scoreSearchResult(result, query, { referenceTime = null } = {}) {
  const text = snippetText(result).toLowerCase();
  const terms = parseSearchTerms(query);
  const positions = terms.map((term) => occurrences(text, term));
  const matchedTerms = positions.filter((matches) => matches.length).length;
  let score = terms.length ? (matchedTerms / terms.length) * SECONDS_PER_MINUTE : 0;

  if (terms.length && matchedTerms === terms.length) score += ALL_TERMS_MATCH_SCORE;
  for (const phrase of quotedPhrases(query)) if (text.includes(phrase)) score += PHRASE_MATCH_SCORE;
  if (terms.length > 1 && text.includes(terms.join(" "))) score += ORDERED_QUERY_SCORE;
  score += proximityScore(positions);

  score += termMatchBoost(text, terms, positions);
  score += roleBoost(result);

  const timestamp = Date.parse(result?.timestamp ?? "");
  if (Number.isFinite(timestamp) && Number.isFinite(referenceTime)) {
    const age = Math.max(0, referenceTime - timestamp);
    score += RECENCY_SCORE_WEIGHT * Math.exp(-age / (PROXIMITY_BASE_SCORE * DAY_MS));
  }
  return score;
}

/** Return a relevance-sorted copy, preserving original order for equal scores. */
export function rescoreSearchResults(results, query) {
  const candidates = Array.isArray(results) ? results : [];
  const referenceTime = candidates.reduce((latest, result) => {
    const timestamp = Date.parse(result?.timestamp ?? "");
    return Number.isFinite(timestamp) && (latest === null || timestamp > latest) ? timestamp : latest;
  }, null);
  return candidates
    .map((result, index) => ({ result, index, score: scoreSearchResult(result, query, { referenceTime }) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ result }) => result);
}
