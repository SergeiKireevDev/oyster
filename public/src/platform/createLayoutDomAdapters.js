/** Browser-backed element boundary used by the settings/layout assembly. */
export function createLayoutDomAdapters({ documentTarget, windowTarget, findElement }) {
  const hublots = findElement("hublots");
  const treebar = findElement("treebar");
  return Object.freeze({
    documentTarget,
    windowTarget,
    hublots,
    treebar,
    isTreeOpen: () => treebar.classList.contains("open"),
    isDrawerToggleTarget(target) {
      return Boolean(target?.closest?.("#hublotChip") || target?.closest?.("#treeChip"));
    },
  });
}
