const MIN_TERM_LENGTH = 3;

/** Parse bare terms, quoted phrases, and an explicit OR operator. */
export function parseSearchQuery(query) {
  // NUL cannot be represented in an FTS5 query string and would make SQLite
  // reject an otherwise valid search. It has no useful meaning in UI input.
  const source = String(query ?? "").replaceAll("\0", "").trim();
  const terms = [];
  const seenTerms = new Set();
  let operator = "AND";
  let current = "";
  let quoted = false;

  function push(isQuoted = quoted) {
    const rawValue = current.trim();
    const value = rawValue.toLowerCase();
    if (!isQuoted && value === "or") {
      operator = "OR";
    } else if (value && (isQuoted || rawValue.length >= MIN_TERM_LENGTH) && !seenTerms.has(value)) {
      seenTerms.add(value);
      terms.push(value);
    }
    current = "";
  }

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === "\\" && source[index + 1] === '"') {
      current += '"';
      index++;
    } else if (character === '"') {
      if (quoted) push(true);
      else if (current.trim()) push(false);
      quoted = !quoted;
    } else if (/\s/.test(character) && !quoted) {
      push(false);
    } else {
      current += character;
    }
  }
  push(quoted);
  return { terms, operator };
}

export function parseSearchTerms(query) {
  return parseSearchQuery(query).terms;
}

/** Build a literal FTS5 expression without exposing query operators. */
export function ftsSearchExpression(terms, operator = "AND") {
  const separator = operator === "OR" ? " OR " : " AND ";
  return terms.map((term) => `"${term.replaceAll("\0", "").replaceAll('"', '""')}"`).join(separator);
}

/** Map a match in lower-cased text back to its range in the source text. */
function sourceMatchRange(source, normalizedSource, normalizedIndex, normalizedLength) {
  if (normalizedSource.length === source.length) {
    return { index: normalizedIndex, length: normalizedLength };
  }

  const normalizedEnd = normalizedIndex + normalizedLength;
  let sourceOffset = 0;
  let normalizedOffset = 0;
  let sourceStart = null;
  for (const character of source) {
    const nextSourceOffset = sourceOffset + character.length;
    const nextNormalizedOffset = normalizedOffset + character.toLowerCase().length;
    if (sourceStart === null && normalizedIndex < nextNormalizedOffset) sourceStart = sourceOffset;
    if (sourceStart !== null && normalizedEnd <= nextNormalizedOffset) {
      return { index: sourceStart, length: nextSourceOffset - sourceStart };
    }
    sourceOffset = nextSourceOffset;
    normalizedOffset = nextNormalizedOffset;
  }

  // Unicode lower-casing currently preserves the per-code-point length sum,
  // but retain a safe fallback if a future runtime changes that invariant.
  return { index: normalizedIndex, length: normalizedLength };
}

/** Return every query term found in one searchable text fragment. */
export function matchingSearchTerms(text, terms) {
  const normalized = text.toLowerCase();
  return terms.flatMap((term, termIndex) => {
    const normalizedTerm = term.toLowerCase();
    if (!normalizedTerm) return [];
    const index = normalized.indexOf(normalizedTerm);
    if (index < 0) return [];
    return [{ termIndex, ...sourceMatchRange(text, normalized, index, normalizedTerm.length) }];
  });
}

/** Return the first match location when the query's term condition is met. */
export function matchSearchText(text, terms, operator = "AND") {
  const matches = matchingSearchTerms(text, terms);
  if (!matches.length || (operator !== "OR" && matches.length !== terms.length)) return null;
  return matches.reduce((first, match) => match.index < first.index ? match : first);
}
