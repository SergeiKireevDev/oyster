function encode(value) {
  return encodeURIComponent(value);
}

/**
 * Owns the Hub workspace/cloud HTTP protocol so components only express user
 * intent and consume domain values.
 */
export function createWorkspaceService({ fetchImpl }) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");

  async function request(path, init) {
    const response = await fetchImpl(path, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  const json = (method, body) => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return Object.freeze({
    async listEnvironments() {
      return (await request("/api/v1/environments")).environments ?? [];
    },
    async listWorkspaces() {
      return (await request("/api/v1/workspaces?probe=0")).workspaces ?? [];
    },
    async createLlmboxWorkspace(payload) {
      return (await request("/api/v1/workspaces", json("POST", payload))).workspace;
    },
    async manageWorkspace(workspaceId, action) {
      const destroy = action === "destroy";
      return request(
        `/api/v1/workspaces/${encode(workspaceId)}${destroy ? "" : "/actions"}`,
        destroy ? { method: "DELETE" } : json("POST", { action }),
      );
    },
    async listCloudProviders() {
      return (await request("/api/v1/cloud/providers")).providers ?? [];
    },
    googleComputeConsoleUrl(projectId = "") {
      const base = "https://console.cloud.google.com/apis/library/compute.googleapis.com";
      return projectId ? `${base}?project=${encode(projectId)}` : base;
    },
    disconnectCloudProvider(providerId) {
      return request(`/api/v1/cloud/providers/${encode(providerId)}/credentials`, { method: "DELETE" });
    },
    async startCloudAuthorization(providerId) {
      return (await request(`/api/v1/cloud/providers/${encode(providerId)}/authorization/start`, { method: "POST" })).flow;
    },
    async startAwsRole(accountId) {
      return (await request("/api/v1/cloud/providers/aws/role/start", json("POST", { accountId }))).flow;
    },
    async verifyAwsRole(flowId) {
      return (await request(`/api/v1/cloud/authorization/aws/${encode(flowId)}/verify`, { method: "POST" })).flow;
    },
    async getCloudAuthorization(flowId) {
      return (await request(`/api/v1/cloud/authorization/${encode(flowId)}/status`)).flow;
    },
    async listCloudProjects(providerId) {
      return (await request(`/api/v1/cloud/providers/${encode(providerId)}/projects`)).projects ?? [];
    },
    selectCloudProject(providerId, projectId) {
      return request(`/api/v1/cloud/providers/${encode(providerId)}/projects`, json("POST", { projectId }));
    },
    async startCloudHandoff(providerId) {
      return (await request(`/api/v1/cloud/providers/${encode(providerId)}/handoff/start`, { method: "POST" })).flow;
    },
    async getCloudHandoff(flowId) {
      return (await request(`/api/v1/cloud/handoff/${encode(flowId)}/status`)).flow;
    },
    cancelCloudHandoff(flowId) {
      return request(`/api/v1/cloud/handoff/${encode(flowId)}/cancel`, { method: "POST" });
    },
    saveCloudCredentials(providerId, values) {
      return request(`/api/v1/cloud/providers/${encode(providerId)}/credentials`, json("PUT", values));
    },
    async getCloudOptions(providerId, region = "") {
      const query = region ? `?region=${encode(region)}` : "";
      const data = await request(`/api/v1/cloud/providers/${encode(providerId)}/options${query}`);
      return {
        regions: data.regions ?? [],
        sizes: data.sizes ?? [],
        images: data.images ?? [],
        defaults: data.defaults ?? {},
      };
    },
    async provisionCloudWorkspace(options) {
      return (await request("/api/v1/workspaces", json("POST", options))).workspace;
    },
  });
}
