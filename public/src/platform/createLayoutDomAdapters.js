/** Browser-backed element boundary used by the settings/layout assembly. */
export function createLayoutDomAdapters({ documentTarget, windowTarget, findElement }) {
  const sessions = findElement("sessions");
  const hublots = findElement("hublots");
  const treebar = findElement("treebar");
  return Object.freeze({
    documentTarget,
    windowTarget,
    sessions,
    hublots,
    treebar,
    isTreeOpen: () => treebar.classList.contains("open"),
    isDrawerToggleTarget(target) {
      return Boolean(target?.closest?.("#treeChip"));
    },
  });
}
