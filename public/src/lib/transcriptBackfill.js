/**
 * Schedule tail-first transcript backfill without owning DOM or scroll state.
 * Callers supply the renderer and viewport hooks, keeping this reusable for
 * Svelte transcript stores while preserving the legacy scroll policy.
 */
export async function backfillTranscriptTurns({
  turns,
  takeTailChunk,
  chunkSize,
  isCurrent,
  renderPrepend,
  beforePrepend,
  afterPrepend,
  yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0)),
}) {
  while (turns.length) {
    await yieldToBrowser();
    if (!isCurrent()) return false;
    const chunk = takeTailChunk(turns, chunkSize);
    const snapshot = beforePrepend();
    await renderPrepend(chunk);
    await afterPrepend(snapshot);
  }
  return true;
}
