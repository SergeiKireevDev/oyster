import { WorkspaceDriverError } from "./errors.mjs";

function mergeUnique(groups, key, label) {
  const merged = new Map();
  for (const group of groups) {
    for (const item of group) {
      const id = String(item?.[key] || "");
      if (!id) continue;
      if (merged.has(id)) throw new WorkspaceDriverError(`duplicate ${label} id across workspace drivers: ${id}`);
      merged.set(id, item);
    }
  }
  return [...merged.values()];
}

export function createCompositeWorkspaceDriver(_config, { drivers = [] } = {}) {
  if (!Array.isArray(drivers) || !drivers.length) throw new Error("composite workspace driver requires child drivers");
  const creators = drivers.filter((driver) => driver.capabilities?.create && typeof driver.createWorkspace === "function");

  async function listEnvironments() {
    const groups = await Promise.all(drivers.map(async (driver) => {
      if (typeof driver.listEnvironments === "function") return driver.listEnvironments();
      const workspaces = await driver.listWorkspaces();
      return [...new Map(workspaces.map((workspace) => {
        const id = workspace.environmentId || workspace.provider?.spoke || "unassigned-device";
        return [id, { id, name: workspace.environmentName || id, kind: driver.type === "mock" ? "local" : driver.type, status: "online", local: driver.type === "mock" }];
      })).values()];
    }));
    return mergeUnique(groups, "id", "environment");
  }

  async function listWorkspaces() {
    return mergeUnique(await Promise.all(drivers.map((driver) => driver.listWorkspaces())), "id", "workspace");
  }

  async function getWorkspace(id) {
    const matches = (await Promise.all(drivers.map((driver) => driver.getWorkspace(id)))).filter(Boolean);
    if (matches.length > 1) throw new WorkspaceDriverError(`duplicate workspace id across workspace drivers: ${id}`);
    return matches[0] || null;
  }

  async function createWorkspace(input) {
    const requested = String(input?.driver || "").trim();
    const candidates = requested ? creators.filter((driver) => driver.type === requested) : creators;
    if (!candidates.length) throw new WorkspaceDriverError(requested ? `workspace driver cannot create workspaces: ${requested}` : "no workspace driver can create workspaces", { status: 405 });
    if (candidates.length > 1) throw new WorkspaceDriverError("driver is required when multiple workspace drivers can create workspaces", { status: 400 });
    return candidates[0].createWorkspace(input);
  }

  return Object.freeze({
    type: "composite",
    endpoint: "multiple",
    drivers: Object.freeze([...drivers]),
    capabilities: Object.freeze({
      list: drivers.every((driver) => driver.capabilities?.list !== false),
      create: creators.length > 0,
      remove: drivers.some((driver) => driver.capabilities?.remove),
    }),
    listEnvironments,
    listWorkspaces,
    getWorkspace,
    ...(creators.length ? { createWorkspace } : {}),
  });
}
