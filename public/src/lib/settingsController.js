function modelPickerLabel(model) {
  const identity = `${model.provider}/${model.id}`;
  const name = typeof model.name === "string" ? model.name.trim() : "";
  const resolved = typeof model.resolvedModel === "string" ? model.resolvedModel.trim() : "";
  const details = [name && name !== model.id ? name : "", resolved && resolved !== model.id ? resolved : ""].filter(Boolean);
  return details.length ? `${identity} — ${details.join(" · ")}` : identity;
}

export function createSettingsController({ rpc, pickOption, refreshState, toast, getState }) {
  async function chooseModel() {
    try {
      const { models } = await rpc({ type: "get_available_models" });
      const labels = models.map(modelPickerLabel);
      const current = getState?.()?.model;
      const selected = models.findIndex((model) => model.provider === current?.provider
        && (model.id === current?.id || model.resolvedModel === current?.id));
      const choice = await pickOption("Select model", labels, {
        searchable: true,
        selected,
        disabled: models.map((model) => model.disabled === true),
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
