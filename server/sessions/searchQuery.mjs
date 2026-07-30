const MIN_TERM_LENGTH = 3;

/** Parse bare terms, quoted phrases, and an explicit OR operator. */
export function parseSearchQuery(query) {
  const source = String(query ?? "").trim();
  const terms = [];
  let operator = "AND";
  let current = "";
  let quoted = false;

  function push(isQuoted = quoted) {
    const value = current.trim().toLowerCase();
    if (!isQuoted && value === "or") operator = "OR";
    else if (value && (isQuoted || value.length >= MIN_TERM_LENGTH) && !terms.includes(value)) terms.push(value);
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
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(separator);
}

/** Return every query term found in one searchable text fragment. */
export function matchingSearchTerms(text, terms) {
  const normalized = text.toLowerCase();
  return terms.flatMap((term, termIndex) => {
    const index = normalized.indexOf(term);
    return index < 0 ? [] : [{ termIndex, index, length: term.length }];
  });
}

/** Return the first match location when the query's term condition is met. */
export function matchSearchText(text, terms, operator = "AND") {
  const matches = matchingSearchTerms(text, terms);
  if (!matches.length || (operator !== "OR" && matches.length !== terms.length)) return null;
  return matches.reduce((first, match) => match.index < first.index ? match : first);
}
