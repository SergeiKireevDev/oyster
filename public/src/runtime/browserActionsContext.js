import { getContext, setContext } from "svelte";

const BROWSER_ACTIONS_CONTEXT = Symbol("browser-actions");

export function provideBrowserActions(actions) {
  setContext(BROWSER_ACTIONS_CONTEXT, actions);
  return actions;
}

export function getBrowserActions() {
  return getContext(BROWSER_ACTIONS_CONTEXT);
}
