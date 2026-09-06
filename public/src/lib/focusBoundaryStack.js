/** Per-document focus ownership, including nested dialogs above compact drawers. */
const documents = new WeakMap();

export function registerFocusBoundary(node, priority = 100) {
  const documentTarget = node.ownerDocument;
  let state = documents.get(documentTarget);
  if (!state) {
    state = { entries: [], isolated: new Map() };
    documents.set(documentTarget, state);
  }
  const entry = { node, priority };
  const top = () => state.entries.reduce((best, candidate) => (
    !best || candidate.priority >= best.priority ? candidate : best
  ), null);

  function isolate() {
    for (const [element, previous] of state.isolated) element.inert = previous;
    state.isolated.clear();
    const active = top()?.node;
    // Isolate siblings along the active surface's ancestor path, not its
    // ancestors. This also handles a modal opened from a full-screen drawer.
    for (let branch = active; branch?.parentElement; branch = branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch) continue;
        state.isolated.set(sibling, sibling.inert);
        sibling.inert = true;
      }
      if (branch.parentElement === documentTarget.body) break;
    }
  }

  state.entries.push(entry);
  isolate();
  return {
    isTop: () => top() === entry,
    release() {
      const index = state.entries.indexOf(entry);
      if (index < 0) return;
      state.entries.splice(index, 1);
      isolate();
      if (!state.entries.length) documents.delete(documentTarget);
    },
  };
}
