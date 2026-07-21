/** Temporary object-shaped adapter while checkpoint domain callers move to row APIs. */
export function createCheckpointStore(repository) {
  if (!repository?.load || !repository?.save) throw new Error("checkpoint repository is required");
  const loadCheckpoints = () => repository.load();
  const saveCheckpoints = (value) => repository.save(value);
  const deleteSessionCheckpoints = (sessionId) => {
    const value = loadCheckpoints();
    const count = value[sessionId]?.length ?? 0;
    if (Object.hasOwn(value, sessionId)) {
      delete value[sessionId];
      saveCheckpoints(value);
    }
    return count;
  };
  return Object.freeze({ loadCheckpoints, saveCheckpoints, deleteSessionCheckpoints });
}
