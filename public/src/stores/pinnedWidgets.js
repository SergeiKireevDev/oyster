import { writable } from "svelte/store";

export const pinnedWidgets = writable([]);
export const pinnedWidgetGroups = writable([]);
// The first collection request starts independently of transcript replay. Keep
// the rail visibly pending until that request settles instead of flashing an
// empty widget collection while the session bootstraps.
export const pinnedWidgetsLoading = writable(true);
export const pinnedWidgetsError = writable("");
export const pinnedWidgetActiveGroup = writable(null);

export function setPinnedWidgetCollection({ widgets = [], groups = [] } = {}) {
  pinnedWidgets.set(widgets);
  pinnedWidgetGroups.set(groups);
  pinnedWidgetActiveGroup.update((id) => id && groups.some((group) => group.id === id) ? id : null);
}
