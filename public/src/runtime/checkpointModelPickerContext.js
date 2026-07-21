import { getContext, setContext } from "svelte";

export const CHECKPOINT_MODEL_PICKER_CONTEXT = Symbol("pi-checkpoint-model-picker");

export function provideCheckpointModelPicker(service) {
  setContext(CHECKPOINT_MODEL_PICKER_CONTEXT, service);
  return service;
}

export function getCheckpointModelPicker() {
  return getContext(CHECKPOINT_MODEL_PICKER_CONTEXT);
}
