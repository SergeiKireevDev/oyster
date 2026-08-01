/** Browser-backed element boundary used by the settings/layout assembly. */
export function createLayoutDomAdapters({ documentTarget, windowTarget, findElement }) {
  const sessions = findElement("sessions");
  const hublots = findElement("hublots");
  return Object.freeze({
    documentTarget,
    windowTarget,
    sessions,
    hublots,
    isTreeOpen: () => false,
    isDrawerToggleTarget: () => false,
  });
}
