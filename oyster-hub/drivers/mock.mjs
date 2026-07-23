import { WorkspaceDriverError } from "./errors.mjs";

export function createMockWorkspaceDriver(config) {
  const configured = config.workspaces ?? [config];
  const workspaces = Object.freeze(configured.map((workspace) => Object.freeze({
    environmentId: workspace.environmentId || "local",
    environmentName: workspace.environmentName || "Local",
    id: workspace.id,
    name: workspace.name,
    url: workspace.endpoint,
    token: workspace.token || null,
    provider: Object.freeze({
      type: "mock",
      state: "running",
      local: true,
    }),
  })));

  const environments = Object.freeze([...new Map(workspaces.map((workspace) => [workspace.environmentId || "local", Object.freeze({
    id: workspace.environmentId || "local",
    name: workspace.environmentName || "Local",
    status: "online",
    local: (workspace.environmentId || "local") === "local",
  })])).values()]);

  return Object.freeze({
    type: "mock",
    endpoint: config.endpoint,
    capabilities: Object.freeze({ list: true, create: false, remove: false }),
    async listEnvironments() {
      return environments;
    },
    async listWorkspaces() {
      return workspaces;
    },
    async getWorkspace(id) {
      return workspaces.find((workspace) => id === workspace.id) ?? null;
    },
    async createWorkspace() {
      throw new WorkspaceDriverError("mock workspace driver cannot create workspaces", { status: 405 });
    },
    async removeWorkspace() {
      throw new WorkspaceDriverError("mock workspace driver cannot remove workspaces", { status: 405 });
    },
  });
}
