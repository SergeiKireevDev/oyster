export function commandTrigger(element) {
  const caret = element.selectionStart;
  const match = element.value.slice(0, caret).match(/(^|\s):([a-zA-Z0-9_]*)$/);
  return match ? { text: `:${match[2]}`, start: caret - match[2].length } : null;
}

export function filterCommands(commands, match) {
  const query = (match || "").toLowerCase();
  return query ? commands.filter((command) => command.name.startsWith(query)) : commands;
}

export function createCommandGuard() {
  // Slash-prefixed messages are intentionally allowed through to pi. In RPC
  // mode, pi's prompt handler attempts extension commands, prompt templates,
  // and skills before treating input as plain text.
  return { confirmKnownCommand: async () => true, reset: () => {} };
}
