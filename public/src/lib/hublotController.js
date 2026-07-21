/** Route the Svelte-owned sidebar add action to the hublot workflow. */
export function createHublotSidebarEventController({ windowTarget, show }) {
  const onShow = () => show();
  function attach() {
    windowTarget.addEventListener("pi-hublot-show", onShow);
    return detach;
  }
  function detach() {
    windowTarget.removeEventListener("pi-hublot-show", onShow);
  }
  return { attach, detach };
}

export function createManagedHublotEventController({ windowTarget, create, openCommandPalette, toggleScope }) {
  const listeners = [
    ["pi-managed-hublot-create", (event) => create(event.detail)],
    ["pi-managed-command-palette", (event) => openCommandPalette(event.detail)],
    ["pi-managed-hublot-toggle-scope", () => toggleScope()],
  ];
  function attach() {
    for (const [name, listener] of listeners) windowTarget.addEventListener(name, listener);
    return detach;
  }
  function detach() {
    for (const [name, listener] of listeners) windowTarget.removeEventListener(name, listener);
  }
  return { attach, detach };
}

export function createHublotController({ createHublot, getSessionId, setDescription, setCreating, close, toast, listHublots, listSidebarHublots, isAuthenticated, setSidebarLoading, setSidebarTunnels, isVisible, updateManager, getScopeAll, getDescription }) {
  async function create(description) {
    const text = (description ?? "").trim();
    setDescription(description ?? "");
    if (!text) { toast("describe what the hublot should expose", "warning"); return; }
    setCreating(true);
    try { const data = await createHublot({ label: text, sessionId: getSessionId(), brief: text }); setDescription(""); close(); toast(`hublot ready at ${data.tunnel.url}`); }
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
