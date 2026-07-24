import { writable } from "svelte/store";

export const cloudEnvironmentChanges = writable({ revision: 0, environment: null });

export function publishCloudEnvironment(environment) {
  cloudEnvironmentChanges.update(({ revision }) => ({ revision: revision + 1, environment }));
}
