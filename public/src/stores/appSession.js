import { derived, writable } from "svelte/store";

export const appSession = writable({
  state: null,
  currentRunner: null,
  runners: [],
  workdir: null,
  busy: false,
  connected: false,
});

export const appHeader = derived(appSession, ($appSession) => {
  const state = $appSession.state;
  const model = state?.model;
  const modelId = model?.id ?? "no model";
  const thinking = state?.thinkingLevel ?? "think";
  const workdir = $appSession.workdir ?? "";
  return {
    connectionClass: $appSession.connected ? `dot ${$appSession.busy ? "busy" : "ok"}` : "dot",
    sessionTitle: state?.sessionName || "pi-lot",
    modelChip: modelId,
    thinkChip: state ? `think: ${thinking}` : "think",
    cfgChip: state ? `${modelId} · ${thinking}` : "model · think",
    workdirText: workdir ? `📁 ${workdir.length > 40 ? "…" + workdir.slice(-39) : workdir}` : "",
    workdirTitle: workdir,
  };
});

export function updateAppSession(patch) {
  appSession.update((session) => ({ ...session, ...patch }));
}
