export const ACTIVE_WORKSPACE_KEY = "oyster_hub_workspace";

export function isHubRuntime(runtimeConfig = globalThis.__OYSTER_RUNTIME_CONFIG__) {
  return runtimeConfig?.hub === true;
}

export function getActiveWorkspace(storage = localStorage) {
  return isHubRuntime() ? (storage.getItem(ACTIVE_WORKSPACE_KEY) || null) : null;
}

export function setActiveWorkspace(workspaceId, storage = localStorage) {
  if (!isHubRuntime() || !workspaceId) return false;
  storage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
  return true;
}

/** List physical/cloud environments (llmbox spokes) known to the Hub. */
export async function listEnvironments({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl("/api/v1/environments");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `failed to list environments (${response.status})`);
  return data.environments ?? [];
}

/** List the workspaces that can currently host a new session. */
export async function listOnlineWorkspaces({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl("/api/v1/workspaces");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `failed to list workspaces (${response.status})`);
  return (data.workspaces ?? []).filter((workspace) => workspace.status === "online");
}

/** Require an explicit workspace choice before starting a Hub session. */
export async function chooseOnlineWorkspace({ fetchImpl = fetch, choose }) {
  if (typeof choose !== "function") throw new TypeError("choose is required");
  const workspaces = await listOnlineWorkspaces({ fetchImpl });
  if (!workspaces.length) throw new Error("no online workspaces available — create a workspace first");
  const selectedIndex = await choose(workspaces);
  return selectedIndex == null ? null : workspaces[selectedIndex] ?? null;
}

/** Resolve an explicit workspace before the Hub opens any workspace-scoped stream. */
export async function ensureActiveWorkspace({
  runtimeConfig = globalThis.__OYSTER_RUNTIME_CONFIG__,
  storage = localStorage,
  fetchImpl = fetch,
} = {}) {
  if (!isHubRuntime(runtimeConfig)) return null;
  const available = await listOnlineWorkspaces({ fetchImpl });
  if (!available.length) throw new Error("no workspaces available — create an environment or workspace first");
  const persisted = storage.getItem(ACTIVE_WORKSPACE_KEY);
  const selected = available.find((workspace) => workspace.id === persisted) ?? available[0];
  storage.setItem(ACTIVE_WORKSPACE_KEY, selected.id);
  return selected;
}
