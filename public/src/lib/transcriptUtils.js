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
  while (turns.length && (chunk.length === 0 || chunk.length + turns[turns.length - 1].length <= max)) {
    chunk.unshift(...turns.pop());
    if (chunk.length >= max) break;
  }
  return chunk;
}
