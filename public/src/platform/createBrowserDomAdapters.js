/** Explicit browser DOM capabilities consumed by application assemblies. */
export function createBrowserDomAdapters({ documentTarget, findElement }) {
  return Object.freeze({
    findElement,
    gate: findElement("gate"),
    createFileInput: () => documentTarget.createElement("input"),
  });
}
