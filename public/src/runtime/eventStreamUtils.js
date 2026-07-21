export function createSseDeduper(maxIds = 2000) {
  const ids = new Set();
  const queue = [];
  return (message) => {
    const id = message?._sseId;
    if (!id) return false;
    if (ids.has(id)) return true;
    ids.add(id);
    queue.push(id);
    while (queue.length > maxIds) ids.delete(queue.shift());
    return false;
  };
}
