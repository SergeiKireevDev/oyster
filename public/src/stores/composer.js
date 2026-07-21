import { derived, writable } from "svelte/store";
import { appSession } from "./appSession.js";

export const composerText = writable("");

export const composerUi = derived([appSession, composerText], ([$appSession, $composerText]) => {
  const busy = !!$appSession.busy;
  const hasText = !!String($composerText ?? "").trim();
  return {
    sendText: busy ? "Steer" : "Send",
    sendHidden: busy && !hasText,
    stopHidden: !busy,
  };
});

export function setComposerTextValue(text) {
  composerText.set(text ?? "");
}
