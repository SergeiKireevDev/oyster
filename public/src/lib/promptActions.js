export function isSlashCommandText(text) {
  return /^\/\S/.test(text);
}

export function promptCommand(text, busy) {
  // Slash-prefixed input may be a pi command (extension command, prompt
  // template, or skill). Send it as a prompt without forcing steering so pi
  // gets a chance to execute/expand it even while the session is busy.
  return { type: "prompt", message: text, ...(busy && !isSlashCommandText(text) ? { streamingBehavior: "steer" } : {}) };
}
