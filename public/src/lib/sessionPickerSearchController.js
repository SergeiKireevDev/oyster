import { sessionIdentity } from "./sessionIdentity.js";

export function createSessionPickerSearchController({ getSnapshot, update, fetchSearch, groupResults }) {
  async function search() {
    const snap = getSnapshot();
    const q = snap.query.trim();
    if (q.length < 2) return update({ searchStatus: "", searchResults: [], searching: false });
    const scope = snap.scope;
    let path = scope === "folder" ? (snap.folderPath ?? "") : "";
    if (scope === "session") {
      const current = snap.sessions.find((session) => session.id === snap.currentId) ?? snap.sessions[0];
      if (!current) return update({ searchStatus: "no saved session to search", searchResults: [] });
      path = sessionIdentity(current);
    }
    update({ searchStatus: "searching…", searchResults: [], searching: true });
    try {
      const { ok, status, data } = await fetchSearch({ q, scope, path, includeTools: !snap.excludeTools });
      const latest = getSnapshot();
      if (latest.query.trim() !== q || latest.scope !== scope) return;
      if (!ok) return update({ searchStatus: data.error || `search failed (${status})`, searchResults: [], searching: false });
      update({ searchStatus: `${data.results.length} hit${data.results.length === 1 ? "" : "s"} in ${data.filesSearched} file${data.filesSearched === 1 ? "" : "s"}` + (data.truncated ? " (truncated)" : ""), searchResults: groupResults(data.results), searchFilesSearched: data.filesSearched, searchTruncated: !!data.truncated, searching: false });
    } catch (error) { update({ searchStatus: `search failed: ${error.message}`, searchResults: [], searching: false }); }
  }
  function setScope(scope) { update({ scope }); return search(); }
  function setFolder(folderPath) { update({ folderPath }); return search(); }
  function setExcludeTools(excludeTools) { update({ excludeTools }); return search(); }
  return { search, setScope, setFolder, setExcludeTools };
}
