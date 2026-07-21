import { getContext, setContext } from "svelte";

export const AUTH_BROWSER_CONTEXT = Symbol("pi-auth-browser");

export function provideAuthBrowser(service) {
  setContext(AUTH_BROWSER_CONTEXT, service);
  return service;
}

export function getAuthBrowser() {
  return getContext(AUTH_BROWSER_CONTEXT);
}
