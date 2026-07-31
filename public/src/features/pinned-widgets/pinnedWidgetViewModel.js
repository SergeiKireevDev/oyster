const comparePositionAndLabel = (left, right) => (
  left.position - right.position || left.label.localeCompare(right.label)
);

const comparePositionAndName = (left, right) => (
  left.position - right.position || left.name.localeCompare(right.name)
);

const scopeOrder = new Map([["workspace", 0], ["session", 1]]);
const compareViewerOrder = (left, right) => (
  (scopeOrder.get(left.scope) ?? 2) - (scopeOrder.get(right.scope) ?? 2)
  || comparePositionAndLabel(left, right)
);

export function isPinnedWidgetViewerArtifact(widget) {
  return ["image", "video", "markdown", "monitoring"].includes(widget?.kind)
    || String(widget?.mimeType ?? "").startsWith("text/html");
}

/**
 * Resolves the arrows in the native artifact viewer. Top-level artifacts follow
 * the rail's workspace/session order; an artifact in a group can only move
 * among the other viewer-compatible members of that group.
 */
export function buildPinnedWidgetViewerNavigation(widgets, currentId) {
  const current = widgets.find((widget) => widget.id === currentId);
  if (!current) return { previous: null, next: null, index: -1, total: 0 };
  const groupId = current.groupId ?? null;
  const sequence = widgets
    .filter((widget) => (widget.groupId ?? null) === groupId && isPinnedWidgetViewerArtifact(widget))
    .sort(compareViewerOrder);
  const index = sequence.findIndex((widget) => widget.id === currentId);
  return {
    previous: index > 0 ? sequence[index - 1] : null,
    next: index >= 0 && index < sequence.length - 1 ? sequence[index + 1] : null,
    index,
    total: sequence.length,
  };
}

/**
 * Indexes and sorts the complete pinned-widget collection once per store update.
 * Components can then render sections and group previews without rescanning the
 * collection from inside snippets or each blocks.
 */
export function buildPinnedWidgetViewModel(widgets, groups, scopes) {
  const childrenByGroup = new Map();
  for (const widget of widgets) {
    if (widget.groupId == null) continue;
    if (!childrenByGroup.has(widget.groupId)) childrenByGroup.set(widget.groupId, []);
    childrenByGroup.get(widget.groupId).push(widget);
  }
  for (const children of childrenByGroup.values()) children.sort(comparePositionAndLabel);

  const sections = scopes.map((section) => {
    const scopedWidgets = widgets
      .filter((widget) => widget.scope === section.scope && widget.groupId == null)
      .sort(comparePositionAndLabel);
    const scopedGroups = groups
      .filter((group) => group.scope === section.scope)
      .sort(comparePositionAndName)
      .map((group) => ({ ...group, children: childrenByGroup.get(group.id) ?? [] }));
    return {
      ...section,
      builtinWidgets: scopedWidgets.filter((widget) => widget.kind === "builtin"),
      movableWidgets: scopedWidgets.filter((widget) => widget.kind !== "builtin"),
      groups: scopedGroups,
      empty: scopedWidgets.length === 0 && scopedGroups.length === 0,
    };
  });

  const groupWidgets = new Map();
  for (const group of groups) groupWidgets.set(group.id, childrenByGroup.get(group.id) ?? []);
  return { sections, groupWidgets };
}
