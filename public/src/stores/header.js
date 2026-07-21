import { writable } from "svelte/store";

export const headerState = writable({
  connectionClass: "dot",
  sessionTitle: "pi-lot",
  cfgChip: "model · think",
  modelChip: "model",
  thinkChip: "think",
  stateInfo: "connecting…",
  workdirText: "",
  workdirTitle: "",
  usageInfo: "",
  sendText: "Send",
  sendHidden: false,
  stopHidden: true,
});

export function updateHeaderState(patch) {
  headerState.update((state) => ({ ...state, ...patch }));
}
