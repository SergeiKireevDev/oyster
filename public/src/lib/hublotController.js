export function createHublotSidebarController({ target, show }) {
  const onClick = () => show();
  function attach() {
    target.addEventListener("click", onClick);
    return detach;
  }
  function detach() {
    target.removeEventListener("click", onClick);
  }
  return { attach, detach };
}

export function createHublotController({ createHublot, getSessionId, setDescription, setCreating, close, toast, listHublots, listSidebarHublots, isAuthenticated, setSidebarLoading, setSidebarTunnels, isVisible, updateManager, getScopeAll, getDescription }) {
  async function create(description) {
    const text = (description ?? "").trim();
    setDescription(description ?? "");
    if (!text) { toast("describe what the hublot should expose", "warning"); return; }
    setCreating(true);
    try { const data = await createHublot({ label: text, sessionId: getSessionId(), brief: text }); setDescription(""); close(); toast(`hublot opening at ${data.tunnel.url} — background agent is setting it up…`); }
    catch (error) { toast(`hublot failed: ${error.message}`, "error"); } finally { setCreating(false); }
  }
  async function refresh({ loading = false } = {}) {
    const common = { scopeAll: getScopeAll(), currentSessionId: getSessionId(), desc: getDescription() };
    updateManager({ loading, ...common });
    try { const tunnels = await listHublots(); updateManager({ loading: false, tunnels: tunnels.filter(isVisible), total: tunnels.length, ...common }); }
    catch (error) { updateManager({ loading: false, tunnels: [], total: 0 }); toast(`failed to list hublots: ${error.message}`, "error"); }
  }
  async function refreshSidebar() {
    if (!isAuthenticated()) return;
    setSidebarLoading(true);
    let tunnels = [];
    try { tunnels = await listSidebarHublots(); } catch { /* sidebar is best-effort */ }
    setSidebarTunnels(tunnels);
    setSidebarLoading(false);
  }
  return { create, refresh, refreshSidebar };
}
