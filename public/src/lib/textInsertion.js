export function insertionAtCaret(value, selectionStart, selectionEnd, text) {
  const start = selectionStart ?? value.length;
  const before = value.slice(0, start);
  const after = value.slice(selectionEnd ?? start);
  const pad = before && !/\s$/.test(before) ? " " : "";
  const padAfter = after && !/^\s/.test(after) ? " " : "";
  return { value: before + pad + text + padAfter + after, position: (before + pad + text).length };
}

export function insertionReplacing(value, placeholder, text) {
  const index = placeholder ? value.lastIndexOf(placeholder) : -1;
  if (index === -1) return null;
  const before = value.slice(0, index);
  const after = value.slice(index + placeholder.length);
  const pad = before && !/\s$/.test(before) ? " " : "";
  const padAfter = after && !/^\s/.test(after) ? " " : "";
  return { value: before + pad + text + padAfter + after, position: (before + pad + text).length };
}
