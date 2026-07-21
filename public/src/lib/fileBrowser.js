export function browserPathFor(basePath, entry) {
  return `${String(basePath).replace(/\/$/, "")}/${entry.name}`;
}

export function visibleBrowserEntries(entries = [], showHidden = true) {
  return showHidden ? entries : entries.filter((entry) => !entry.hidden);
}

export function fmtFileSize(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
