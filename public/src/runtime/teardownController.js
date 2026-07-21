/** Execute runtime cleanup callbacks once, preserving their registration order. */
export function createRuntimeTeardown(cleanups) {
  let disposed = false;
  return () => {
    if (disposed) return false;
    disposed = true;
    for (const cleanup of cleanups) cleanup();
    return true;
  };
}
