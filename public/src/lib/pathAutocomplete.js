const PATH_TRIGGER = /(^|\s)((?:\.\/|\/)[^\s]*)$/;

/** Return the path token immediately before the caret, if it starts with / or ./. */
export function pathTrigger(element) {
  const caret = element.selectionStart ?? element.value.length;
  const match = element.value.slice(0, caret).match(PATH_TRIGGER);
  if (!match) return null;
  const text = match[2];
  return { text, start: caret - text.length };
}

/** Resolve the directory to browse and the unfinished entry name. */
export function pathCompletionRequest(text, workdir) {
  const slash = text.lastIndexOf("/");
  const typedDir = text.slice(0, slash + 1);
  const prefix = text.slice(slash + 1);
  if (text.startsWith("./")) {
    const relativeDir = typedDir.slice(2);
    return { browsePath: relativeDir ? `${workdir}/${relativeDir}` : workdir, typedDir, prefix };
  }
  // The filesystem API is deliberately confined and cannot list /. Browse a
  // safe root so its response can identify the allowed workspace/home roots.
  return typedDir === "/"
    ? { browsePath: workdir, typedDir, prefix, allowedRoots: true }
    : { browsePath: typedDir, typedDir, prefix };
}

/** Build completion choices from one /browse response. */
export function pathCompletionItems(_trigger, request, data) {
  const query = request.prefix.toLowerCase();
  if (request.allowedRoots) {
    return [...new Set([data.path, data.home].filter(Boolean))]
      .map((path) => ({ path: `${String(path).replace(/\/$/, "")}/`, name: String(path).split("/").filter(Boolean).at(-1) ?? "/", directory: true }))
      .filter((entry) => entry.name.toLowerCase().startsWith(query));
  }

  const entries = [
    ...(data.dirs ?? []).map((entry) => ({ ...entry, directory: true })),
    ...(data.files ?? []).map((entry) => ({ ...entry, directory: false })),
  ].filter((entry) => entry.name.toLowerCase().startsWith(query));

  return entries.map((entry) => {
    const suffix = entry.directory ? "/" : "";
    return { path: `${request.typedDir}${entry.name}${suffix}`, name: entry.name, directory: entry.directory };
  });
}
