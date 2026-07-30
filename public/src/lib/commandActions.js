export function createCommandGuard({ rpc, confirm }) {
  let knownCommands = null;
  async function getKnownCommands() {
    if (knownCommands) return knownCommands;
    try {
      const { commands } = await rpc({ type: "get_commands" });
      knownCommands = Array.isArray(commands) ? commands : [];
    } catch {
      knownCommands = null;
      return [];
    }
    return knownCommands;
  }
  async function confirmKnownCommand(text) {
    if (!text.startsWith("/")) return true;
    const name = text.slice(1).split(/\s+/)[0];
    if (!name || (await getKnownCommands()).some((command) => command.name === name)) return true;
    return confirm("Unknown command", `"/${name}" is not a pi command. Send it to the model as plain text?`);
  }
  return { getKnownCommands, confirmKnownCommand, reset: () => { knownCommands = null; } };
}
