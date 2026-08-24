export function createHublotController({ createHublot, getSessionId, setDescription, setCreating, close, toast, listHublots, listSidebarHublots, isAuthenticated, setSidebarLoading, setSidebarTunnels, setSidebarCollection, setSidebarError = () => {}, isVisible, updateManager, getScopeAll, getDescription }) {
  let sidebarRefreshGeneration = 0;

  async function create(description) {
    const text = (description ?? "").trim();
    setDescription(description ?? "");
    if (!text) { toast("describe what the live interface should expose", "warning"); return; }
    setCreating(true);
    try { const data = await createHublot({ label: text, sessionId: getSessionId(), brief: text }); setDescription(""); close(); toast(`live interface ready at ${data.tunnel.url}`); }
    catch (error) { toast(`live interface failed: ${error.message}`, "error"); } finally { setCreating(false); }
  }
  async function refresh({ loading = false } = {}) {
    const common = { scopeAll: getScopeAll(), currentSessionId: getSessionId(), desc: getDescription() };
    updateManager({ loading, ...common });
    try { const tunnels = await listHublots(); updateManager({ loading: false, tunnels: tunnels.filter(isVisible), total: tunnels.length, ...common }); }
    catch (error) { updateManager({ loading: false, tunnels: [], total: 0 }); toast(`failed to list hublots: ${error.message}`, "error"); }
  }
  async function refreshSidebar(sessionId = getSessionId?.() ?? null) {
    if (!isAuthenticated()) return;
    const generation = ++sidebarRefreshGeneration;
    setSidebarLoading(true);
    setSidebarError("");
    let collection = setSidebarCollection ? { widgets: [], groups: [] } : [];
    let errorMessage = "";
    try { collection = await listSidebarHublots(sessionId); }
    catch (error) { errorMessage = error.message || "Unable to load pinned widgets"; }
    // Session switches can overlap requests. Never let a slower response for
    // the previous session replace either half of the current collection.
    if (generation !== sidebarRefreshGeneration) return;
    if (setSidebarCollection && !Array.isArray(collection)) setSidebarCollection(collection);
    else setSidebarTunnels(Array.isArray(collection) ? collection : collection.widgets ?? []);
    setSidebarError(errorMessage);
    setSidebarLoading(false);
  }
  return { create, refresh, refreshSidebar };
}
