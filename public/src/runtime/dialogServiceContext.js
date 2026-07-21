import { getContext, setContext } from "svelte";

export const DIALOG_SERVICE_CONTEXT = Symbol("pi-dialog-service");

export function provideDialogService(service) {
  setContext(DIALOG_SERVICE_CONTEXT, service);
  return service;
}

export function getDialogService() {
  return getContext(DIALOG_SERVICE_CONTEXT);
}
