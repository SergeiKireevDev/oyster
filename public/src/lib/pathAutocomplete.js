const PATH_TRIGGER = /(^|\s)([^\s]*\/[^\s]*)$/;

/** Return the slash-containing path token immediately before the caret. */
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
  if (!text.startsWith("/")) {
    const base = String(workdir ?? "").replace(/\/$/, "");
    const relativeDir = typedDir.startsWith("./") ? typedDir.slice(2) : typedDir;
    return { browsePath: base ? `${base}/${relativeDir}` : relativeDir, typedDir, prefix };
  }
  // The filesystem API is deliberately confined and cannot list /. Browse a
  // safe root so its response can identify the allowed workspace/home roots.
  return typedDir === "/"
    ? { browsePath: workdir, typedDir, prefix, allowedRoots: true }
    : { browsePath: typedDir, typedDir, prefix };
}

/** Whether the typed token is already one complete file or folder path. */
export function pathCompletionIsExact(trigger, request, data) {
  if (request.allowedRoots) {
    return [data.path, data.home].filter(Boolean)
      .some((path) => `${String(path).replace(/\/$/, "")}/` === trigger.text);
  }
  return [
    ...(data.dirs ?? []).map((entry) => `${request.typedDir}${entry.name}/`),
    ...(data.files ?? []).map((entry) => `${request.typedDir}${entry.name}`),
  ].includes(trigger.text);
}

/** Build completion choices from one /browse response. */
export function pathCompletionItems(trigger, request, data) {
  const query = request.prefix.toLowerCase();
  if (request.allowedRoots) {
    return [...new Set([data.path, data.home].filter(Boolean))]
      .map((path) => ({ path: `${String(path).replace(/\/$/, "")}/`, name: String(path).split("/").filter(Boolean).at(-1) ?? "/", directory: true }))
      .filter((entry) => entry.name.toLowerCase().startsWith(query) && entry.path !== trigger.text);
  }

  const entries = [
    ...(data.dirs ?? []).map((entry) => ({ ...entry, directory: true })),
    ...(data.files ?? []).map((entry) => ({ ...entry, directory: false })),
  ].filter((entry) => entry.name.toLowerCase().startsWith(query));

  return entries.map((entry) => {
    const suffix = entry.directory ? "/" : "";
    return { path: `${request.typedDir}${entry.name}${suffix}`, name: entry.name, directory: entry.directory };
  }).filter((entry) => entry.path !== trigger.text);
}
