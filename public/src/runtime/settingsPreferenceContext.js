import { getContext, setContext } from "svelte";

export const SETTINGS_PREFERENCE_CONTEXT = Symbol("pi-settings-preferences");

export function provideSettingsPreferences(service) {
  setContext(SETTINGS_PREFERENCE_CONTEXT, service);
  return service;
}

export function getSettingsPreferences() {
  return getContext(SETTINGS_PREFERENCE_CONTEXT);
}
