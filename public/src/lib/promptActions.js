export function promptCommand(text, busy) {
  return { type: "prompt", message: text, ...(busy ? { streamingBehavior: "steer" } : {}) };
}
