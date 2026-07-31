import { getContext, setContext } from "svelte";

export const WORKSPACE_SERVICE_CONTEXT = Symbol("oyster-workspace-service");

export function provideWorkspaceService(service) {
  setContext(WORKSPACE_SERVICE_CONTEXT, service);
  return service;
}

export function getWorkspaceService() {
  const service = getContext(WORKSPACE_SERVICE_CONTEXT);
  if (!service) throw new Error("workspace service is unavailable");
  return service;
}
