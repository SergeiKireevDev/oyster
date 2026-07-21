export function createSettingsController({ rpc, pickOption, refreshState, toast }) {
  async function chooseModel() {
    try {
      const { models } = await rpc({ type: "get_available_models" });
      const choice = await pickOption("Select model", models.map((model) => `${model.provider}/${model.id}`), { searchable: true });
      if (choice == null) return;
      const model = models[choice];
      await rpc({ type: "set_model", provider: model.provider, modelId: model.id });
      toast(`model: ${model.id}`);
    } catch (error) { toast(error.message, "error"); }
  }
  async function cycleThinking() {
    try {
      const data = await rpc({ type: "cycle_thinking_level" });
      if (data) toast(`thinking: ${data.level}`);
      refreshState();
    } catch (error) { toast(error.message, "error"); }
  }
  return { chooseModel, cycleThinking };
}
