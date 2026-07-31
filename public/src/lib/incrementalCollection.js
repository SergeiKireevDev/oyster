export const DEFAULT_COLLECTION_PAGE_SIZE = 40;

/**
 * Return a stable prefix for incremental collection rendering.
 * Existing item references and order are preserved so keyed Svelte rows are
 * retained when another page is revealed.
 */
export function incrementalCollectionPage(items, requested, pageSize = DEFAULT_COLLECTION_PAGE_SIZE) {
  const collection = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.trunc(Number(pageSize)) || DEFAULT_COLLECTION_PAGE_SIZE);
  const requestedCount = Math.max(size, Math.trunc(Number(requested)) || size);
  const visibleCount = Math.min(collection.length, requestedCount);
  return {
    items: collection.slice(0, visibleCount),
    pageSize: size,
    visibleCount,
    remainingCount: collection.length - visibleCount,
  };
}

export function nextCollectionPageCount(current, total, pageSize = DEFAULT_COLLECTION_PAGE_SIZE) {
  const size = Math.max(1, Math.trunc(Number(pageSize)) || DEFAULT_COLLECTION_PAGE_SIZE);
  const visible = Math.max(size, Math.trunc(Number(current)) || size);
  return Math.min(Math.max(0, Math.trunc(Number(total)) || 0), visible + size);
}
