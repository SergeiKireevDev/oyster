const comparePositionAndLabel = (left, right) => (
  left.position - right.position || left.label.localeCompare(right.label)
);

const comparePositionAndName = (left, right) => (
  left.position - right.position || left.name.localeCompare(right.name)
);

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
