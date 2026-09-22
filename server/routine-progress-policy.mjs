const MIN_PROGRESS_MARKERS = 3;

/** Advisory routine-authoring checks; never reject a script on these heuristics. */
export function progressionWarnings(script) {
  const warnings = [];
  const markers = script.match(/::progress\b/g)?.length ?? 0;
  if (markers < MIN_PROGRESS_MARKERS) warnings.push("fewer than three explicit progress updates");
  if (!/::progress\s+(?:0|[1-9])%?(?:\s|["'])/.test(script)) warnings.push("no explicit starting progress update");
  if (!/::progress\s+100%?(?:\s|["'])/.test(script)) warnings.push("no explicit 100% completion update");
  return warnings;
}
