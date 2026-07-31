import { writable } from "svelte/store";

export const pinnedWidgets = writable([]);
export const pinnedWidgetGroups = writable([]);
export const pinnedWidgetsLoading = writable(false);
export const pinnedWidgetsError = writable("");
export const pinnedWidgetActiveGroup = writable(null);

export function setPinnedWidgetCollection({ widgets = [], groups = [] } = {}) {
  pinnedWidgets.set(widgets);
  pinnedWidgetGroups.set(groups);
  pinnedWidgetActiveGroup.update((id) => id && groups.some((group) => group.id === id) ? id : null);
}
