function searchTerms(query) {
  const source = String(query ?? "").trim();
  const terms = [];
  let current = "";
  let quoted = false;

  function push() {
    const value = current.trim();
    if (value && (quoted || value.length >= 3) && !terms.some((term) => term.toLowerCase() === value.toLowerCase())) {
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
      if (quoted) push();
      else if (current.trim()) push();
      quoted = !quoted;
    } else if (/\s/.test(character) && !quoted) {
      push();
    } else {
      current += character;
    }
  }
  push();
  return terms;
}

/** Split a server-provided search snippet into safely renderable highlighted spans. */
export function highlightSearchSnippet(snippet, query) {
  const before = String(snippet?.before ?? "");
  const primary = String(snippet?.match ?? "");
  const after = String(snippet?.after ?? "");
  const text = `${before}${primary}${after}`;
  const normalized = text.toLowerCase();
  const ranges = [];

  for (const term of searchTerms(query)) {
    const needle = term.toLowerCase();
    for (let index = normalized.indexOf(needle); index >= 0; index = normalized.indexOf(needle, index + needle.length)) {
      ranges.push({ start: index, end: index + needle.length });
    }
  }
  if (!ranges.length && primary) ranges.push({ start: before.length, end: before.length + primary.length });
  ranges.sort((left, right) => left.start - right.start || right.end - left.end);

  const segments = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), match: false });
    segments.push({ text: text.slice(range.start, range.end), match: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}
