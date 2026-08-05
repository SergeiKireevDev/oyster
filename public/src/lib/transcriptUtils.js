export function alignedTranscriptIndex(entryCount, elementCount, entryIndex) {
  return entryCount === elementCount ? entryIndex : elementCount - (entryCount - entryIndex);
}

export function splitTurns(messages = []) {
  const turns = [];
  let current = [];
  for (const message of messages) {
    if (message?.role === "user" && current.length) {
      turns.push(current);
      current = [];
    }
    current.push(message);
  }
  if (current.length) turns.push(current);
  return turns;
}

export function takeTailChunk(turns, max, { preserveOversizedTurn = false } = {}) {
  const chunk = [];
  while (turns.length) {
    const turn = turns[turns.length - 1];
    const available = max - chunk.length;
    if (turn.length > available) {
      if (chunk.length) break;
      if (preserveOversizedTurn) {
        chunk.unshift(...turns.pop());
        break;
      }
      // Backfill may split an older tool-heavy turn so no deferred chunk
      // monopolizes the browser main thread.
      chunk.unshift(...turn.splice(-max));
      if (!turn.length) turns.pop();
      break;
    }
    chunk.unshift(...turns.pop());
    if (chunk.length >= max) break;
  }
  return chunk;
}
