import { writable } from "svelte/store";

export const workspaceChanges = writable({ revision: 0, workspace: null });

export function publishWorkspace(workspace) {
  workspaceChanges.update(({ revision }) => ({ revision: revision + 1, workspace }));
}
