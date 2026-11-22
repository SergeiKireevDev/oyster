function modelPickerLabel(model) {
  const identity = `${model.provider}/${model.id}`;
  const name = typeof model.name === "string" ? model.name.trim() : "";
  const resolved = typeof model.resolvedModel === "string" ? model.resolvedModel.trim() : "";
  const details = [name && name !== model.id ? name : "", resolved && resolved !== model.id ? resolved : ""].filter(Boolean);
  return details.length ? `${identity} — ${details.join(" · ")}` : identity;
}

export function createSettingsController({ rpc, pickOption, refreshState, toast, getState, getRunnerId = () => null }) {
  async function chooseModel() {
    try {
      const runnerId = getRunnerId();
      const { models = [], selectionLabel = "model" } = await rpc({ type: "get_available_models" });
      if (runnerId !== getRunnerId()) return;
      if (!models.length) {
        toast("No models are currently available for this harness.");
        return;
      }
      const labels = models.map(modelPickerLabel);
      const current = getState?.()?.model;
      const selected = models.findIndex((model) => model.provider === current?.provider
        && (model.id === current?.id || model.resolvedModel === current?.id));
      const choice = await pickOption(`Select ${selectionLabel}`, labels, {
        searchable: true,
        selected,
        disabled: models.map((model) => model.disabled === true),
        variant: "model",
        placeholder: "Search providers and models…",
      });
      if (choice == null || runnerId !== getRunnerId()) return;
      const model = models[choice];
      await rpc({ type: "set_model", provider: model.provider, modelId: model.id });
      toast(`${selectionLabel}: ${model.id}`);
      await refreshState();
    } catch (error) { toast(error.message, "error"); }
  }
  // Every harness answers the same two commands: the levels its current model
  // supports (optionally with the active and default ones), then the selection.
  async function chooseThinking() {
    try {
      const runnerId = getRunnerId();
      const { levels = [], current, defaultLevel, hint } = await rpc({ type: "get_available_thinking_levels" }) ?? {};
      if (runnerId !== getRunnerId()) return;
      const active = current ?? getState?.()?.thinkingLevel ?? null;
      if (!levels.length) {
        toast(hint ?? "Thinking level is not adjustable for this model.");
        return;
      }
      if (levels.length === 1 && levels[0] === active) {
        toast(`Thinking level is fixed at ${active} for this model.`);
        return;
      }
      const labels = levels.map((level) => level === defaultLevel ? `${level} — default` : level);
      const choice = await pickOption("Select thinking level", labels, { selected: levels.indexOf(active) });
      if (choice == null || runnerId !== getRunnerId()) return;
      const level = levels[choice];
      if (level === active) return;
      await rpc({ type: "set_thinking_level", level });
      toast(`thinking: ${level}`);
      await refreshState();
    } catch (error) { toast(error.message, "error"); }
  }
  async function openConfig() {
    const state = getState?.() ?? {};
    const choice = await pickOption("Settings", [
      `Model: ${state.model?.id ?? "?"} — change…`,
      `Thinking: ${state.thinkingLevel ?? "default"} — change…`,
    ]);
    if (choice === 0) return chooseModel();
    if (choice === 1) return chooseThinking();
  }
  return { chooseModel, chooseThinking, openConfig };
}
