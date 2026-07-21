import { derived, writable } from "svelte/store";
import { appSession } from "./appSession.js";

export const composerText = writable("");

export const composerUi = derived([appSession, composerText], ([$appSession, $composerText]) => {
  const busy = !!$appSession.busy;
  const connected = !!$appSession.connected;
  const replaying = !!$appSession.replayingTranscript;
  const ready = connected && !replaying;
  const hasText = !!String($composerText ?? "").trim();
  return {
    ready,
    inputDisabled: !ready,
    sendDisabled: !ready,
    placeholder: !connected
      ? "connecting…"
      : replaying && $appSession.transcriptLoadPhase === "replay"
        ? "replaying transcript…"
        : replaying && $appSession.transcriptLoadPhase === "canonical"
          ? "loading canonical transcript…"
          : replaying
            ? "loading transcript…"
            : "message (type : for commands)",
    sendText: busy ? "Steer" : "Send",
    sendHidden: busy && !hasText,
    stopHidden: !busy,
  };
});

export function setComposerTextValue(text) {
  composerText.set(text ?? "");
}
