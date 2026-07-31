export function createSettingsController({ rpc, pickOption, refreshState, toast, getState }) {
  async function chooseModel() {
    try {
      const { models } = await rpc({ type: "get_available_models" });
      const labels = models.map((model) => `${model.provider}/${model.id}`);
      const current = getState?.()?.model;
      const selected = models.findIndex((model) => model.provider === current?.provider && model.id === current?.id);
      const choice = await pickOption("Select model", labels, {
        searchable: true,
        selected,
        variant: "model",
        placeholder: "Search providers and models…",
      });
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
  async function openConfig() {
    const state = getState?.() ?? {};
    const choice = await pickOption("Settings", [
      `Model: ${state.model?.id ?? "?"} — change…`,
      `Thinking: ${state.thinkingLevel ?? "?"} — cycle`,
    ]);
    if (choice === 0) return chooseModel();
    if (choice === 1) return cycleThinking();
  }
  return { chooseModel, cycleThinking, openConfig };
}
