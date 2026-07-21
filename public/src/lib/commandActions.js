export function createCommandGuard({ rpc, confirm }) {
  let knownCommands = null;
  async function getKnownCommands() {
    if (knownCommands) return knownCommands;
    try {
      const { commands } = await rpc({ type: "get_commands" });
      knownCommands = new Set(commands.map((command) => command.name));
    } catch {
      knownCommands = null;
      return new Set();
    }
    return knownCommands;
  }
  async function confirmKnownCommand(text) {
    if (!text.startsWith("/")) return true;
    const name = text.slice(1).split(/\s+/)[0];
    if (!name || (await getKnownCommands()).has(name)) return true;
    return confirm("Unknown command", `"/${name}" is not a pi command. Send it to the model as plain text?`);
  }
  return { confirmKnownCommand, reset: () => { knownCommands = null; } };
}
