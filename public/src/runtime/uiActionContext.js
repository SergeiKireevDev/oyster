import { getContext, setContext } from "svelte";

export const UI_ACTION_REGISTRY_CONTEXT = Symbol("oyster-action-registry");

export function provideUiActionRegistry(registry) {
  setContext(UI_ACTION_REGISTRY_CONTEXT, registry);
  return registry;
}

export function getUiActionRegistry() {
  return getContext(UI_ACTION_REGISTRY_CONTEXT);
}
