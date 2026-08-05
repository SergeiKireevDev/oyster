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

export function takeTailChunk(turns, max) {
  const chunk = [];
  while (turns.length) {
    const turn = turns[turns.length - 1];
    const available = max - chunk.length;
    if (turn.length > available) {
      // Preserve ordinary turn boundaries, but never let one tool-heavy turn
      // defeat the render budget and monopolize the browser main thread.
      if (chunk.length) break;
      chunk.unshift(...turn.splice(-max));
      if (!turn.length) turns.pop();
      break;
    }
    chunk.unshift(...turns.pop());
    if (chunk.length >= max) break;
  }
  return chunk;
}
